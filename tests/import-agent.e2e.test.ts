import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { seedCatalog } from "./support/seed-catalog.ts";
import { catalogSeed } from "./support/catalog.ts";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import {
  inspectSource,
  listAgentIssues,
  claimAgentIssue,
  resolveAgentIssue,
  releaseAgentIssue,
  resumeAgentIssue,
} from "../lib/ingestion/agent-issues.ts";
import { GET, POST } from "../app/api/ingestion/agent/route.ts";
import {
  createIngestionRun,
  persistAttempt,
} from "../lib/ingestion/repository.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
process.env.IMPORT_AGENT_SECRET = "test-only-agent-secret-".repeat(3);
let sourceId: string;
const evidence = (
  field: string,
  url = "https://festival.example.test/2027",
) => ({
  field,
  url,
  checkedAt: new Date().toISOString(),
  contentHash: "a".repeat(64),
  excerpt: "Official 2027 reviewed " + field,
});
const checked = {
  action: "apply",
  reason: "Independently reviewed official 2027 announcement",
  evidence: [evidence("city")],
  facts: { city: "Verified City" },
};
const resolveCase = (
  claim: Awaited<ReturnType<typeof claimAgentIssue>>,
  decision: unknown,
) => resolveAgentIssue(db, { ...claim, decision });
test.beforeEach(async () => {
  await db.festivalSource.deleteMany({
    where: { festivalSlug: "synthetic-fest" },
  });
  await db.operationalState.deleteMany({
    where: { key: { startsWith: "ingestion-agent-" } },
  });
  await db.operationalState.deleteMany({ where: { key: { startsWith: "parser-repair-" } } });
  await seedCatalog(db, catalogSeed);
  const festival = await db.festival.findUniqueOrThrow({
    where: { slug: "synthetic-fest" },
  });
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festivalId: festival.id, recordState: "CURRENT" },
  });
  const source = await db.festivalSource.create({
    data: {
      festivalSlug: festival.slug,
      festivalId: festival.id,
      editionId: edition.id,
      editionYear: edition.year,
      url: "https://festival.example.test/" + randomUUID(),
      strategies: ["manual_review"],
      parserKey: "manual_review",
      refreshPolicy: "weekly",
      cadenceSeconds: 604800,
      manualReviewReason: "Synthetic official page requires review",
    },
  });
  sourceId = source.id;
});
test.after(async () => {
  await db.$disconnect();
});
async function claim() {
  const issue = await inspectSource(db, sourceId);
  assert.ok(issue);
  return claimAgentIssue(db, sourceId, issue.issueId);
}
test("leases prevent duplicate agents; wrong capabilities cannot release or resolve", async () => {
  const c = await claim();
  assert.equal((await listAgentIssues(db)).ready, 0);
  await assert.rejects(claimAgentIssue(db, sourceId, c.issueId), /busy/);
  await assert.rejects(
    resolveCase({ ...c, leaseToken: randomUUID() }, checked),
    /busy/,
  );
  await assert.rejects(releaseAgentIssue(db, c.issueId, randomUUID()), /busy/);
  await releaseAgentIssue(db, c.issueId, c.leaseToken);
  assert.equal((await listAgentIssues(db)).ready, 1);
});
test("concurrent claimers have one winner; expired/replaced capabilities cannot write", async () => {
  const issue = await inspectSource(db, sourceId);
  assert.ok(issue);
  const results = await Promise.allSettled([
    claimAgentIssue(db, sourceId, issue.issueId),
    claimAgentIssue(db, sourceId, issue.issueId),
  ]);
  const winners = results.filter(
    (
      r,
    ): r is PromiseFulfilledResult<
      Awaited<ReturnType<typeof claimAgentIssue>>
    > => r.status === "fulfilled",
  );
  assert.equal(winners.length, 1);
  const first = winners[0].value;
  await db.operationalState.update({
    where: { key: first.key },
    data: { leaseExpiresAt: new Date(0) },
  });
  const second = await claim();
  assert.notEqual(first.leaseToken, second.leaseToken);
  await assert.rejects(resolveCase(first, checked), /busy/);
  await resolveCase(second, checked);
});
test("stale snapshot and active importer reject writes; release permits a fresh claim", async () => {
  const c = await claim();
  await db.festival.update({
    where: { slug: "synthetic-fest" },
    data: { city: "Concurrent change" },
  });
  await assert.rejects(resolveCase(c, checked), /stale/);
  assert.equal(
    (await db.festival.findUniqueOrThrow({ where: { slug: "synthetic-fest" } }))
      .city,
    "Concurrent change",
  );
  await releaseAgentIssue(db, c.issueId, c.leaseToken);
  const next = await claim();
  assert.notEqual(next.snapshot, c.snapshot);
  await db.festivalSource.update({
    where: { id: sourceId },
    data: {
      leaseOwner: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60000),
    },
  });
  await assert.rejects(resolveCase(next, checked), /busy/);
});
test("verified resolution commits audit/provenance once, replays safely and enqueues no playlists", async () => {
  const c = await claim();
  const queueBefore = await db.catalogPlaylistRefresh.count();
  const receipt = await resolveCase(c, checked);
  assert.ok(receipt.publicationId);
  assert.equal(
    (await db.festival.findUniqueOrThrow({ where: { slug: "synthetic-fest" } }))
      .city,
    "Verified City",
  );
  assert.equal(await db.catalogPlaylistRefresh.count(), queueBefore);
  assert.deepEqual(await resolveCase(c, checked), receipt);
  assert.equal(
    await db.adminAuditEntry.count({
      where: {
        action: "ingestion.agent.apply",
        metadata: { path: ["issueId"], equals: c.issueId },
      },
    }),
    1,
  );
  assert.equal(
    (await db.editionProvenance.count({
      where: { editionId: c.current.editionId!, field: "city" },
    })) > 0,
    true,
  );
  assert.equal((await listAgentIssues(db)).ready, 0);
  const future = await listAgentIssues(db, new Date(Date.now() + 8 * 86400000));
  assert.equal(future.ready, 1);
});
test("billing promotion is atomic and keeps artist identity, completeness and provider boundaries", async () => {
  const c = await claim();
  const receipt = await resolveCase(c, {
    action: "apply",
    reason: checked.reason,
    facts: {
      headliners: ["Verified New Headliner"],
      lineup: ["Sample Artist"],
      status: "partial",
    },
    evidence: ["headliners", "lineup", "status"].map((f) => evidence(f)),
  });
  assert.ok(receipt.publicationId);
  const edition = await db.festivalEdition.findUniqueOrThrow({
    where: { id: c.current.editionId! },
    include: { lineup: { include: { artist: true } } },
  });
  assert.equal(edition.completeness, "PARTIAL");
  assert.equal(
    edition.lineup.find((l) => l.artist.name === "Sample Artist")?.billing,
    "LINEUP",
  );
  assert.equal(
    edition.lineup.find((l) => l.artist.name === "Verified New Headliner")
      ?.billing,
    "HEADLINER",
  );
  assert.equal(
    await db.catalogPlaylistRefresh.count({
      where: { publicationId: receipt.publicationId },
    }),
    0,
  );
});
test("wrong edition, untrusted evidence and cross-billing duplicates roll back catalog writes", async () => {
  const c = await claim();
  await assert.rejects(
    resolveCase(c, {
      ...checked,
      evidence: [evidence("city", "https://evil.example.test/")],
    }),
    /invalid/,
  );
  await assert.rejects(
    resolveCase(c, {
      ...checked,
      facts: { startDate: "2028-06-10" },
      evidence: [evidence("startDate")],
    }),
    /dates mismatch/,
  );
  await assert.rejects(
    resolveCase(c, {
      ...checked,
      facts: { headliners: ["Sample Artist"], lineup: ["Sample Artist"] },
      evidence: ["headliners", "lineup"].map((f) => evidence(f)),
    }),
    /billing/,
  );
  assert.equal(
    (await db.festival.findUniqueOrThrow({ where: { slug: "synthetic-fest" } }))
      .city,
    "Sample City",
  );
});
test("retry backs off; genuine questions are deduplicated without hiding new issues", async () => {
  const c = await claim();
  const r = await resolveCase(c, {
    action: "retry",
    reason: "Official site temporarily unavailable; retry later",
  });
  assert.ok(r.retryAt);
  assert.equal((await listAgentIssues(db)).ready, 0);
  assert.equal(
    (await listAgentIssues(db, new Date(Date.now() + 61 * 60000))).ready,
    1,
  );
  await db.operationalState.update({
    where: { key: c.key },
    data: { payload: {} },
  });
  const next = await claim();
  await resolveCase(next, {
    action: "needs_user",
    reason: "Two official venues disagree without a dated correction",
    question: "Which confirmed venue did the organizer communicate to you?",
  });
  assert.equal(
    (await listAgentIssues(db, new Date(Date.now() + 20 * 86400000))).ready,
    0,
  );
  await resumeAgentIssue(
    db,
    sourceId,
    next.issueId,
    "The organizer confirmed the new venue directly.",
  );
  assert.equal((await listAgentIssues(db)).ready, 1);
  await db.festivalSource.update({
    where: { id: sourceId },
    data: { url: "https://festival.example.test/new-announcement" },
  });
  assert.equal((await listAgentIssues(db)).ready, 1);
});
test("registered source changes are audited; unknown adapters cannot silently activate", async () => {
  const c = await claim(),
    url = "https://festival.example.test/2027";
  const decision = {
    action: "apply",
    reason: checked.reason,
    source: { url, strategies: ["json_ld_event"], refreshPolicy: "daily" },
    evidence: [evidence("source", url)],
  };
  await assert.rejects(
    resolveCase(c, {
      ...decision,
      source: { ...decision.source, strategies: ["official_markup"] },
    }),
    /Unknown official parser/,
  );
  const r = await resolveCase(c, decision);
  assert.equal(r.publicationId, null);
  const source = await db.festivalSource.findUniqueOrThrow({
    where: { id: sourceId },
  });
  assert.equal(source.parserKey, "json_ld_event");
  assert.equal(source.cadenceSeconds, 86400);
  // No fresh attempt under this configuration: old/manual data are not replayed.
  assert.equal(await inspectSource(db, sourceId), null);
});
test("disabled sources and archived editions never surface or accept an old claim", async () => {
  const c = await claim();
  await db.festivalSource.update({
    where: { id: sourceId },
    data: { enabled: false },
  });
  assert.equal((await listAgentIssues(db)).ready, 0);
  await assert.rejects(resolveCase(c, checked), /stale/);
  await db.festivalSource.update({
    where: { id: sourceId },
    data: { enabled: true },
  });
  await db.festivalEdition.update({
    where: { id: c.current.editionId! },
    data: { recordState: "ARCHIVED" },
  });
  assert.equal((await listAgentIssues(db)).ready, 0);
  await assert.rejects(resolveCase(c, checked), /stale/);
});
test("failed current attempts wake the agent without raw errors; later success clears them", async () => {
  const s = await db.festivalSource.findUniqueOrThrow({
      where: { id: sourceId },
    }),
    now = new Date();
  await db.festivalSource.update({
    where: { id: sourceId },
    data: {
      strategies: ["json_ld_event"],
      parserKey: "json_ld_event",
      configurationBackfilledAt: new Date(now.getTime() - 1000),
      lastAttemptAt: now,
      consecutiveFailures: 1,
      lastError: "HTTP 503 private server diagnostic",
    },
  });
  const run = await db.ingestionRun.create({
    data: {
      trigger: "TEST",
      status: "COMPLETED",
      sourceCommit: "test",
      schemaVersion: 1,
      startedAt: now,
      totalSources: 1,
    },
  });
  await db.ingestionAttempt.create({
    data: {
      runId: run.id,
      festivalSlug: s.festivalSlug,
      requestedUrl: s.url,
      httpStatus: 503,
      durationMs: 1,
      parserVersions: {},
      status: "FAILED",
      startedAt: now,
      endedAt: now,
      error: "private diagnostic",
    },
  });
  const issue = await inspectSource(db, sourceId);
  assert.ok(issue);
  assert.equal(issue.kind, "failure");
  assert.equal(issue.failureCategory, "http");
  assert.equal(JSON.stringify(issue).includes("private diagnostic"), false);
  await db.festivalSource.update({
    where: { id: sourceId },
    data: {
      consecutiveFailures: 0,
      lastError: null,
      lastSuccessAt: new Date(now.getTime() + 1000),
    },
  });
  assert.equal(await inspectSource(db, sourceId), null);
});
test("artist ambiguity rolls back an entire reviewed replacement", async () => {
  await db.artist.upsert({
    where: { slug: "collision-agent" },
    create: {
      slug: "collision-agent",
      name: "Different Existing Artist",
      identityState: "UNRESOLVED",
      aliases: [],
      genres: [],
      topTracks: [],
      recentSetlists: [],
      freshness: {},
    },
    update: {},
  });
  const c = await claim();
  await assert.rejects(
    resolveCase(c, {
      action: "apply",
      reason: checked.reason,
      facts: { headliners: ["Collision Agent"], lineup: [] },
      evidence: ["headliners", "lineup"].map((f) => evidence(f)),
    }),
    /slug collision/,
  );
  assert.equal(
    await db.lineupEntry.count({
      where: {
        editionId: c.current.editionId!,
        artist: { name: "Sample Artist" },
      },
    }),
    1,
  );
});
test("a real persisted REVIEW candidate is resolved atomically with its audit and disposition", async () => {
  const s = await db.festivalSource.update({
      where: { id: sourceId },
      data: { strategies: ["json_ld_event"], parserKey: "json_ld_event" },
    }),
    now = new Date(),
    fetchedAt = now.toISOString();
  const run = await createIngestionRun(db, {
    trigger: "TEST",
    sourceCommit: "test",
    totalSources: 1,
  });
  const attempt = await persistAttempt(db, {
    runId: run.id,
    festivalSlug: s.festivalSlug,
    requestedUrl: s.url,
    finalUrl: s.url,
    httpStatus: 200,
    durationMs: 1,
    startedAt: now,
    endedAt: now,
    result: {
      schemaVersion: 1,
      festivalSlug: s.festivalSlug,
      sourceUrl: s.url,
      fetchedAt,
      publishable: false,
      reviewReasons: ["Moved start date requires review"],
      changes: [
        {
          kind: "date_changed",
          field: "startDate",
          before: "2027-06-10",
          after: "2027-06-11",
          reviewRequired: true,
        },
      ],
      candidate: {
        schemaVersion: 1,
        festivalSlug: s.festivalSlug,
        sourceUrl: s.url,
        fetchedAt,
        startDate: "2027-06-11",
        observedEditionYears: [2027],
        warnings: [],
        evidence: [
          {
            field: "startDate",
            sourceUrl: s.url,
            observedAt: fetchedAt,
            excerpt: "2027 June 11–12 official announcement",
          },
        ],
      },
    },
  });
  const c = await claim();
  assert.equal(c.kind, "review");
  assert.equal(c.candidate?.facts.startDate, "2027-06-11");
  const receipt = await resolveCase(c, {
    action: "apply",
    reason: checked.reason,
    facts: { startDate: "2027-06-11" },
    evidence: [evidence("startDate", s.url)],
  });
  const stored = await db.ingestionCandidate.findUniqueOrThrow({
    where: { attemptId: attempt.id },
  });
  assert.equal(stored.reviewState, "PUBLISHED");
  assert.equal(stored.catalogueVersion, receipt.publicationId);
  assert.equal((await listAgentIssues(db)).ready, 0);
});
test("HTTP boundary rejects wrong auth, malformed bodies and oversized streams before mutation", async () => {
  const url = "https://festival.example.test/api/ingestion/agent/";
  assert.equal((await GET(new Request(url))).status, 401);
  const headers = {
    authorization: "Bearer " + process.env.IMPORT_AGENT_SECRET,
  };
  assert.equal(
    (await POST(new Request(url, { method: "POST", headers, body: "{" })))
      .status,
    400,
  );
  assert.equal(
    (
      await POST(
        new Request(url, { method: "POST", headers, body: "x".repeat(65537) }),
      )
    ).status,
    413,
  );
  const signal = await GET(new Request(url + "?mode=signal", { headers }));
  assert.equal(signal.status, 200);
  const body = await signal.json();
  assert.equal(body.ready, 1);
  assert.equal(body.issues, undefined);
  const i = await inspectSource(db, sourceId);
  assert.ok(i);
  const response = await POST(
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation: "claim",
        sourceId,
        issueId: i.issueId,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const c = await response.json();
  assert.ok(c.leaseToken);
  const resolved = await POST(
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation: "resolve",
        sourceId,
        issueId: c.issueId,
        snapshot: c.snapshot,
        leaseToken: c.leaseToken,
        decision: checked,
      }),
    }),
  );
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).status, "resolved");
});

test('correction atomically creates deduplicated parser repair; leased completion/retry receipt is fenced', async () => {
 const { listParserRepairs, claimParserRepair, finishParserRepair } = await import('../lib/ingestion/parser-repairs.ts');
 const i=await inspectSource(db,sourceId);const c=await claimAgentIssue(db,sourceId,i!.issueId);
 const receipt=await resolveCase(c,checked);
 assert.ok(typeof receipt.parserRepairId === "string");
 const repairId = receipt.parserRepairId;
 assert.equal((await resolveCase(c,checked)).parserRepairId,receipt.parserRepairId);
 const list=await listParserRepairs(db);assert.ok(list.issues.some((j:any)=>j.repairId===receipt.parserRepairId));
 const claim=await claimParserRepair(db,repairId);
 await assert.rejects(claimParserRepair(db,repairId),/busy/);
 await assert.rejects(finishParserRepair(db,repairId,randomUUID(),{status:'retry',reason:'Synthetic stale worker retry'}),/busy/);
 const result={status:'completed' as const,reason:'Fixture reproduces corrected extraction and release verified',prUrl:'https://github.com/KirDE/festival-radar/pull/999',commit:'a'.repeat(40)};
 assert.equal((await finishParserRepair(db,repairId,claim.leaseToken,result)).status,'completed');
 assert.equal((await finishParserRepair(db,repairId,claim.leaseToken,result)).status,'completed');
 assert.ok(!(await listParserRepairs(db)).issues.some((j:any)=>j.repairId===receipt.parserRepairId));
});

test('repair capability activates only its registered deployed adapter, preserves backoff/catalogue/provider state', async () => {
 const {enqueueParserRepair,claimParserRepair,configureParserRepair}=await import('../lib/ingestion/parser-repairs.ts');
 const fixture={...catalogSeed,festivals:catalogSeed.festivals.map(f=>({...f,slug:'firenze-rocks'})),editions:catalogSeed.editions.map(e=>({...e,slug:'firenze-rocks'}))};
 await seedCatalog(db,fixture);
 const festival=await db.festival.findUniqueOrThrow({where:{slug:'firenze-rocks'}});
 const edition=await db.festivalEdition.findFirstOrThrow({where:{festivalId:festival.id,recordState:'CURRENT'}});
 const next=new Date(Date.now()+604800000),failed=new Date(Date.now()-86400000);
 const s=await db.festivalSource.create({data:{festivalSlug:'firenze-rocks',festivalId:festival.id,editionId:edition.id,editionYear:2027,
   url:'https://festival.example.test/',strategies:['manual_review'],parserKey:'manual_review',refreshPolicy:'daily',cadenceSeconds:86400,
   nextRunAt:next,consecutiveFailures:3,failureStartedAt:failed,lastError:'Preserve original failure'}});
 try {
   const repairId=await enqueueParserRepair(db,{sourceId:s.id,festivalSlug:'firenze-rocks',year:2027,issueId:'test-activation',parserKey:s.parserKey,sourceUrl:s.url});
   const claim=await claimParserRepair(db,repairId);
   const input={repairId,leaseToken:claim.leaseToken as string,expectedParserKey:s.parserKey!,followLinkPattern:null};
   const beforeEdition=await db.festivalEdition.findUnique({where:{id:edition.id},include:{lineup:true,playlists:true}});
   const beforeProvider=await db.catalogPlaylistRefresh.count();
   await assert.rejects(configureParserRepair(db,{...input,leaseToken:randomUUID()}),/busy/);
   await assert.rejects(configureParserRepair(db,{...input,expectedParserKey:'html_fallback'}),/stale/);
   await assert.rejects(configureParserRepair(db,{...input,followLinkPattern:'unanchored.*'}),/invalid/);
   await db.festivalSource.update({where:{id:s.id},data:{url:'https://changed.example.test/'}});
   await assert.rejects(configureParserRepair(db,input),/stale/);
   await db.festivalSource.update({where:{id:s.id},data:{url:s.url}});
   await db.festivalSource.update({where:{id:s.id},data:{leaseOwner:'importer',leaseExpiresAt:new Date(Date.now()+60000)}});
   await assert.rejects(configureParserRepair(db,input),/busy/);
   await db.festivalSource.update({where:{id:s.id},data:{leaseOwner:null,leaseExpiresAt:null}});
   // The bearer-protected route exercises the same fenced transaction.
   const request=()=>new Request('https://radar.example.test/api/ingestion/agent/',{method:'POST',headers:{authorization:'Bearer '+process.env.IMPORT_AGENT_SECRET,'content-type':'application/json'},body:JSON.stringify({operation:'repair_configure',...input})});
   assert.equal((await POST(request())).status,200);
   assert.equal((await POST(request())).status,200); // idempotent under the held capability
   const after=await db.festivalSource.findUniqueOrThrow({where:{id:s.id}});
   assert.equal(after.parserKey,'official_markup:firenze-rocks');assert.deepEqual(after.strategies,['official_markup']);
   assert.equal(after.followLinkPattern,input.followLinkPattern);assert.equal(after.nextRunAt!.toISOString(),next.toISOString());
   assert.equal(after.consecutiveFailures,3);assert.equal(after.failureStartedAt!.toISOString(),failed.toISOString());assert.equal(after.lastError,s.lastError);
   assert.deepEqual(await db.festivalEdition.findUnique({where:{id:edition.id},include:{lineup:true,playlists:true}}),beforeEdition);
   assert.equal(await db.catalogPlaylistRefresh.count(),beforeProvider);
   assert.equal(await db.adminAuditEntry.count({where:{action:'ingestion.parser.configured',resourceKey:'firenze-rocks',metadata:{path:['repairId'],equals:repairId}}}),1);
   await db.operationalState.update({where:{key:'parser-repair-'+repairId},data:{leaseExpiresAt:new Date(0)}});
   await assert.rejects(configureParserRepair(db,input),/busy/);
   const unknown=await enqueueParserRepair(db,{sourceId,festivalSlug:'synthetic-fest',year:2027,issueId:'test-unregistered',parserKey:'manual_review',sourceUrl:(await db.festivalSource.findUniqueOrThrow({where:{id:sourceId}})).url});
   const unregistered=await claimParserRepair(db,unknown);
   await assert.rejects(configureParserRepair(db,{repairId:unknown,leaseToken:unregistered.leaseToken as string,expectedParserKey:'manual_review',followLinkPattern:null}),/invalid/);
 } finally {await db.festivalSource.delete({where:{id:s.id}});await db.festival.delete({where:{id:festival.id}});}
});
