import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { claimDueSources } from "../lib/ingestion/lease.ts";
import { drainIngestionNotificationOutbox } from "../lib/ingestion/notification-outbox.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("Disposable test/integration DATABASE_URL required");
const db = new PrismaClient();
const slug = "due-worker-" + randomUUID().slice(0, 8);
let sourceId;
let dir;
let runIds = [];
const orphanRunIds = [];
const fixture = '<html><script type="application/ld+json">{"@type":"MusicEvent","startDate":"2027-07-07"}</script></html>';

function run(extra = [], output = path.join(dir, "out-" + randomUUID()), envExtra = {}) {
  return spawnSync(process.execPath, ["scripts/ingest-festivals.mjs", "--db-due", "--publish", ...(extra.some((value) => value.startsWith("--fixture=")) ? [] : ["--fixture=" + path.join(dir, "fixture.html")]), "--output=" + output, ...extra], {
    encoding: "utf8",
    env: { ...process.env, APP_URL: "", NOTIFICATION_EVENTS_URL: "", INTERNAL_API_SECRET: "", NOTIFICATION_DELIVERY_REQUIRED: "false", ...envExtra },
  });
}

test.before(async () => {
  if (process.env.TEST_DB_TIMEZONE) {
    const [session] = await db.$queryRaw`SELECT current_setting('TimeZone') AS "TimeZone"`;
    assert.equal(session.TimeZone, process.env.TEST_DB_TIMEZONE);
  }
  dir = await mkdtemp(path.join(tmpdir(), "due-worker-"));
  await writeFile(path.join(dir, "fixture.html"), fixture);
  const festival = await db.festival.create({ data: {
    slug, name: "Worker Fixture", country: "Test", countryCode: "DE", officialUrl: "https://example.test/worker", genres: [],
    editions: { create: { year: 2027, status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: new Date() } },
  } });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id } });
  const source = await db.festivalSource.create({ data: {
    festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: "https://example.test/worker",
    strategies: ["manual_review"], parserKey: "manual_review", refreshPolicy: "daily", cadenceSeconds: 86400,
    enabled: true, editionYear: 2027, configurationBackfilledAt: new Date(), nextRunAt: new Date(Date.now() - 1000),
  } });
  sourceId = source.id;
});
test.after(async () => {
  runIds = [...orphanRunIds, ...(await db.ingestionRun.findMany({ where: { attempts: { some: { festivalSlug: slug } } }, select: { id: true } })).map((row) => row.id)];
  const candidates = await db.ingestionCandidate.findMany({ where: { runId: { in: runIds } }, select: { id: true } });
  const ids = candidates.map((row) => row.id);
  await db.ingestionDiff.deleteMany({ where: { candidateId: { in: ids } } });
  await db.ingestionEvidence.deleteMany({ where: { candidateId: { in: ids } } });
  await db.ingestionCandidate.deleteMany({ where: { id: { in: ids } } });
  await db.ingestionAttempt.deleteMany({ where: { runId: { in: runIds } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
  await db.ingestionSourceState.deleteMany({ where: { festivalSlug: slug } });
  await db.festivalSource.delete({ where: { id: sourceId } });
  await db.festival.delete({ where: { slug } });
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

test("opt-in worker acknowledges exactly one due source and leaves non-due runs idle", async () => {
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const summary = JSON.parse(first.stdout);
  assert.equal(summary.status, "COMPLETED");
  assert.equal(summary.attempted, 1);
  assert.equal(summary.published, 0);
  const completed = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(completed.leaseOwner, null);
  assert.equal(completed.consecutiveFailures, 0);
  assert.equal(completed.lastError, null);
  assert.ok(completed.nextRunAt > new Date());
  const idle = run();
  assert.equal(idle.status, 0, idle.stderr);
  assert.deepEqual(JSON.parse(idle.stdout), { status: "NO_DUE_SOURCES", attempted: 0 });
});

test("fetch failure persists an attempt and backs off before next claim", async () => {
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  const failed = run(["--fixture=" + path.join(dir, "missing.html")]);
  assert.equal(failed.status, 2, failed.stderr);
  const summary = JSON.parse(failed.stdout);
  assert.equal(summary.fetchErrors, 1);
  const row = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(row.leaseOwner, null);
  assert.equal(row.consecutiveFailures, 1);
  assert.equal(row.lastError, "fetch_error");
  assert.ok(row.nextRunAt > new Date());
  assert.equal(run().status, 0);
});

test("post-fetch local failure releases lease with parser backoff", async () => {
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  const output = path.join(dir, "blocked");
  await mkdir(path.join(output, slug + ".json"), { recursive: true });
  const failed = run([], output);
  assert.notEqual(failed.status, 0);
  const row = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(row.leaseOwner, null);
  assert.equal(row.lastError, "parser_error");
  assert.equal(row.consecutiveFailures, 2);
  assert.ok(row.nextRunAt > new Date());
  const latest = await db.ingestionRun.findFirstOrThrow({ where: { attempts: { some: { festivalSlug: slug } } }, orderBy: { startedAt: "desc" } });
  assert.equal(latest.status, "FAILED");
  assert.ok(latest.endedAt);
});


test("due mode rejects ambiguous manual controls without claiming", async () => {
  const before = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  const invalid = run(["--force"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--db-due requires database and --publish/);
  const after = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.deepEqual(after, before);
});

test("run creation failure releases claimed source without a RUNNING run", async () => {
  const marker = "fail-" + randomUUID();
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  // Disposable PostgreSQL: force INSERT failure only for this test invocation.
  await db.$executeRawUnsafe("CREATE FUNCTION due_worker_reject_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"sourceCommit\" = '" + marker + "' THEN RAISE EXCEPTION 'test run insert failure'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER due_worker_reject_run BEFORE INSERT ON "IngestionRun" FOR EACH ROW EXECUTE FUNCTION due_worker_reject_run()');
  try {
    const publicationsBefore = await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } });
    const failuresBefore = (await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } })).consecutiveFailures;
    const failed = run([], undefined, { GITHUB_SHA: marker });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /test run insert failure/);
    const source = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
    assert.equal(source.leaseOwner, null);
    assert.equal(source.lastError, "pre_attempt_error");
    assert.equal(source.consecutiveFailures, failuresBefore + 1);
    assert.ok(source.nextRunAt > new Date(), "pre-attempt failure backs off instead of retaining the lease");
    assert.equal(await db.ingestionRun.count({ where: { sourceCommit: marker } }), 0);
    assert.equal(await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } }), publicationsBefore);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER due_worker_reject_run ON "IngestionRun"');
    await db.$executeRawUnsafe('DROP FUNCTION due_worker_reject_run()');
  }
});

test("failure before attempt persistence records a safe category and releases the lease", async () => {
  const marker = "fail-" + randomUUID();
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  await db.$executeRawUnsafe("CREATE FUNCTION due_worker_reject_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test attempt insert failure'; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER due_worker_reject_attempt BEFORE INSERT ON "IngestionAttempt" FOR EACH ROW EXECUTE FUNCTION due_worker_reject_attempt()');
  try {
    const publicationsBefore = await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } });
    const failuresBefore = (await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } })).consecutiveFailures;
    const failed = run([], undefined, { GITHUB_SHA: marker });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /test attempt insert failure/);
    const terminal = await db.ingestionRun.findFirstOrThrow({ where: { sourceCommit: marker } });
    orphanRunIds.push(terminal.id);
    assert.equal(terminal.status, "FAILED");
    assert.ok(terminal.endedAt);
    assert.equal(await db.ingestionAttempt.count({ where: { runId: terminal.id } }), 0);
    const source = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
    assert.equal(source.leaseOwner, null);
    assert.equal(source.leaseExpiresAt, null);
    assert.equal(source.lastError, "pre_attempt_error", "never infer a parser failure or persist raw errors/URLs before an attempt");
    assert.equal(source.consecutiveFailures, failuresBefore + 1);
    assert.ok(source.nextRunAt > new Date());
    assert.equal(await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } }), publicationsBefore);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER due_worker_reject_attempt ON "IngestionAttempt"');
    await db.$executeRawUnsafe('DROP FUNCTION due_worker_reject_attempt()');
  }
});

test("cleanup database error does not replace original failure or leave a RUNNING run", async () => {
  const marker = "cleanup-" + randomUUID();
  await db.festivalSource.update({ where: { id: sourceId }, data: {
    enabled: true, strategies: ["manual_review"], parserKey: "manual_review",
    nextRunAt: new Date(Date.now() - 1000), leaseOwner: null, leaseExpiresAt: null,
  } });
  const output = path.join(dir, "blocked-cleanup");
  await mkdir(path.join(output, slug + ".json"), { recursive: true });
  await db.$executeRawUnsafe(
    "CREATE FUNCTION due_worker_reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.\"festivalSlug\" = '" + slug + "' AND OLD.\"leaseOwner\" IS NOT NULL AND NEW.\"leaseOwner\" IS NULL THEN RAISE EXCEPTION 'test cleanup failure'; END IF; RETURN NEW; END $$",
  );
  await db.$executeRawUnsafe('CREATE TRIGGER due_worker_reject_cleanup BEFORE UPDATE ON "FestivalSource" FOR EACH ROW EXECUTE FUNCTION due_worker_reject_cleanup()');
  try {
    const failed = run([], output, { GITHUB_SHA: marker });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /EISDIR/);
    assert.doesNotMatch(failed.stderr, /test cleanup failure/, "the original file error stays primary");
    const terminal = await db.ingestionRun.findFirstOrThrow({ where: { sourceCommit: marker } });
    orphanRunIds.push(terminal.id);
    assert.equal(terminal.status, "FAILED");
    assert.ok(terminal.endedAt);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER due_worker_reject_cleanup ON "FestivalSource"');
    await db.$executeRawUnsafe('DROP FUNCTION due_worker_reject_cleanup()');
    await db.festivalSource.update({ where: { id: sourceId }, data: { leaseOwner: null, leaseExpiresAt: null } });
  }
});

test("publication survives notification failure and independent drain recovers once", async () => {
  const user = await db.user.create({ data: { email: slug + "@example.test", passwordHash: "unused", emailVerifiedAt: new Date() } });
  await db.notificationPreference.create({ data: {
    userId: user.id, festivalId: slug + ":2027", eventType: "FESTIVAL_DATE_MOVED",
    channel: "EMAIL", frequency: "IMMEDIATE",
  } });
  try {
    await db.festivalSource.update({ where: { id: sourceId }, data: {
      nextRunAt: new Date(Date.now() - 1000), strategies: ["json_ld_event"], parserKey: "json_ld_event",
    } });
    // The start and end dates change to the same value: two changes, one
    // notification dedupe key. Legacy sequential upsert keeps the first.
    const duplicateFixture = path.join(dir, "duplicate-event-key.html");
    await writeFile(duplicateFixture, fixture.replace('"startDate":"2027-07-07"', '"startDate":"2027-07-07","endDate":"2027-07-07"'));
    const published = run(["--fixture=" + duplicateFixture], undefined, {
      NOTIFICATION_EVENTS_URL: "http://127.0.0.1:1/events", INTERNAL_API_SECRET: "disposable-test-secret",
    });
    assert.equal(published.status, 0, published.stderr);
    const summary = JSON.parse(published.stdout);
    assert.equal(summary.published, 1);
    assert.equal(summary.results[0].changes, 2, "fixture must produce two date changes");
    assert.equal(summary.notificationEvents, 1, "stage only one event for duplicate key");
    const publication = await db.catalogPublication.findFirstOrThrow({ where: { festivalSlug: slug, source: "INGESTION" } });
    const outbox = await db.ingestionNotificationOutbox.findMany({ where: { publicationId: publication.id } });
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].event.payload.change.field, "startDate", "first change payload wins");
    assert.equal(outbox[0].deliveredAt, null);
    assert.equal(await db.notificationEvent.count({ where: { dedupeKey: outbox[0].dedupeKey } }), 0);
    await assert.rejects(drainIngestionNotificationOutbox(db, {
      afterRecord: async () => { throw new Error("simulated post-record crash"); },
    }), /simulated post-record crash/);
    assert.equal(await db.notificationEvent.count({ where: { dedupeKey: outbox[0].dedupeKey } }), 0);
    assert.equal(await db.notificationDelivery.count({ where: { userId: user.id } }), 0);
    assert.equal((await db.ingestionNotificationOutbox.findUniqueOrThrow({ where: { id: outbox[0].id } })).deliveredAt, null);
    const recovered = spawnSync(process.execPath, ["scripts/drain-ingestion-notifications.mjs", "--db-due"], {
      encoding: "utf8", env: process.env,
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.deepEqual(JSON.parse(recovered.stdout), { delivered: 1 });
    assert.equal(await drainIngestionNotificationOutbox(db), 0);
    const recorded = await db.notificationEvent.findMany({ where: { dedupeKey: outbox[0].dedupeKey } });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].payload.change.field, "startDate");
    assert.equal(await db.notificationDelivery.count({ where: { userId: user.id } }), 1);
    assert.ok((await db.ingestionNotificationOutbox.findUniqueOrThrow({ where: { id: outbox[0].id } })).deliveredAt);
    assert.deepEqual(JSON.parse(run().stdout), { status: "NO_DUE_SOURCES", attempted: 0 });
  } finally {
    await db.notificationDelivery.deleteMany({ where: { userId: user.id } });
    await db.notificationPreference.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});

async function within(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { clearTimeout(timer); }
}

test("in-flight fetch cannot publish after source edit or lease reclaim", async () => {
  const publicationsBefore = await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } });
  for (const change of ["edit", "reclaim"]) {
    await db.festivalEdition.updateMany({ where: { festivalId: (await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } })).festivalId }, data: { startDate: null } });
    let respond;
    let requested;
    const request = new Promise((resolve) => { requested = resolve; });
    const server = createServer((_req, res) => { respond = () => { res.writeHead(200, { "content-type": "text/html" }); res.end(fixture); }; requested(); });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    await db.festivalSource.update({ where: { id: sourceId }, data: {
      strategies: ["json_ld_event"], parserKey: "json_ld_event", fetchUrl: "http://127.0.0.1:" + address.port + "/fixture",
      nextRunAt: new Date(Date.now() - 1000), leaseOwner: null, leaseExpiresAt: null,
    } });
    const child = spawn(process.execPath, ["scripts/ingest-festivals.mjs", "--db-due", "--publish", "--output=" + path.join(dir, "concurrent-" + change)], {
      env: { ...process.env, APP_URL: "", NOTIFICATION_EVENTS_URL: "", INTERNAL_API_SECRET: "", NOTIFICATION_DELIVERY_REQUIRED: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
      await within(request, 10_000, "Worker fetch did not start");
      if (change === "edit") {
        await db.festivalSource.update({ where: { id: sourceId }, data: { cadenceSeconds: 172800, updatedAt: new Date(Date.now() + 60_000) } });
      } else {
        await db.festivalSource.update({ where: { id: sourceId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
        const [reclaimed] = await claimDueSources(db, { owner: randomUUID(), now: new Date(), limit: 1, ttlMs: 30_000 });
        assert.equal(reclaimed.id, sourceId);
      }
      respond();
      const [code] = await within(once(child, "close"), 10_000, "Worker did not exit");
      assert.notEqual(code, 0, stderr);
      assert.match(stderr, /Ingestion source lease is no longer active/);
      assert.equal(await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } }), publicationsBefore);
      const source = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
      if (change === "reclaim") assert.notEqual(source.leaseOwner, null);
      else { assert.equal(source.cadenceSeconds, 172800); assert.equal(source.leaseOwner, null); assert.equal(source.leaseExpiresAt, null); }
      const latest = await db.ingestionRun.findFirstOrThrow({ where: { attempts: { some: { festivalSlug: slug } } }, orderBy: { startedAt: "desc" } });
      assert.equal(latest.status, "FAILED");
      const candidate = await db.ingestionCandidate.findFirstOrThrow({ where: { runId: latest.id } });
      assert.equal(candidate.publishable, true);
    } finally {
      child.kill();
      server.closeAllConnections();
      server.close();
    }
  }
});
