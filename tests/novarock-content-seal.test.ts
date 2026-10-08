import assert from "node:assert/strict";
import test from "node:test";
import { canonicalNovaContent, digestNovaRockContent } from "../lib/ingestion/novarock-content-seal.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";
const fresh = (): any => JSON.parse(JSON.stringify(novaContentFixture().snapshot));

test("complete persisted content digest is independent of object and row retrieval order", () => {
  const s = fresh();
  const digest = digestNovaRockContent(s).contentDigest;
  s.evidence.reverse(); s.diffs.reverse();
  assert.equal(digestNovaRockContent(s).contentDigest, digest);
  assert.equal(canonicalNovaContent({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}');
  for (const value of [undefined, NaN, Infinity, 1.1, new Date(), [, 1], { a: undefined }]) assert.throws(() => canonicalNovaContent(value));
});

test("later card changes digest even when unchanged excerpt hash still verifies", () => {
  const s = fresh();
  const old = digestNovaRockContent(s).contentDigest;
  const hashes = s.evidence.map((e: any) => e.contentHash);
  s.candidate.normalized.lineup[39] = "Synthetic Later Card";
  s.evidence.find((e: any) => e.field === "lineup").observedValue[39] = "Synthetic Later Card";
  assert.deepEqual(s.evidence.map((e: any) => e.contentHash), hashes);
  assert.notEqual(digestNovaRockContent(s).contentDigest, old);
});

test("binds warnings, all diff flags/values/version/timestamps, rows and acquisition fencing", () => {
  const old = digestNovaRockContent(fresh()).contentDigest;
  const changes = [
    (s: any) => { s.candidate.warnings.push("new warning"); s.candidate.normalized.warnings.push("new warning"); },
    (s: any) => { s.diffs[0].reviewRequired = !s.diffs[0].reviewRequired; },
    (s: any) => { s.diffs[0].beforeValue = "changed"; },
    (s: any) => { s.diffs[0].createdAt = "2026-10-09T00:00:00.000Z"; },
    (s: any) => { s.diffs.push({ ...s.diffs[0], id: "extra" }); },
    (s: any) => { s.diffs.pop(); },
    (s: any) => { s.attempt.acquisitionProvenance.leaseVersion++; },
    (s: any) => { s.attempt.acquisitionProvenance.configurationGeneration++; },
    (s: any) => { s.evidence[0].id = "replaced"; },
    (s: any) => { s.run.sourceCommit = "changed"; },
  ];
  for (const change of changes) { const s = fresh(); change(s); assert.notEqual(digestNovaRockContent(s).contentDigest, old); }
});

test("fails closed for unsupported payload, missing/extra evidence, invalid bill and lineage", () => {
  const changes = [
    (s: any) => { s.version = 2; }, (s: any) => { s.candidate.normalized.extra = true; },
    (s: any) => { s.evidence.pop(); }, (s: any) => { s.evidence.push({ ...s.evidence[0], id: "extra" }); },
    (s: any) => { s.evidence[1].id = s.evidence[0].id; },
    (s: any) => { s.evidence[0].contentHash = "0".repeat(64); },
    (s: any) => { s.evidence[0].observedAt = "2026-10-09T00:00:00.000Z"; },
    (s: any) => { s.evidence[0].observedValue = "changed"; },
    (s: any) => { s.candidate.normalized.lineup.pop(); },
    (s: any) => { s.candidate.normalized.lineup.push("Extra"); },
    (s: any) => { s.candidate.normalized.lineup[0] = s.candidate.normalized.headliners[0]; },
    (s: any) => { s.attempt.id = "replaced"; }, (s: any) => { s.run.id = "replaced"; },
    (s: any) => { s.candidate.id = "replaced"; },
    (s: any) => { s.attempt.acquisitionProvenance = null; },
    (s: any) => { s.attempt.parserVersions.extractor = 2; },
    (s: any) => { s.diffs[0].policyVersion = "unsupported"; },
    (s: any) => { s.attempt.acquisitionProvenance.configuration.parserKey = "other"; },
    (s: any) => { s.candidate.reviewState = "APPROVED"; },
  ];
  for (const change of changes) { const s = fresh(); change(s); assert.throws(() => digestNovaRockContent(s)); }
});

import { sealNovaRockContent, verifyNovaRockContentSeal } from "../lib/ingestion/novarock-content-seal.ts";
function databaseDouble() {
  const s = fresh();
  Object.assign(s.candidate, { reviewState: "PENDING", reviewActor: null, reviewedAt: null, publishedAt: null, catalogueVersion: null });
  let seal: any = null;
  let latest: any[] = [{ id: s.attempt.id, endedAt: new Date(s.attempt.endedAt) }];
  let lockCount = 0;
  const tx = {
    $queryRaw: async () => { lockCount++; return []; },
    ingestionCandidate: { findUniqueOrThrow: async ({ select }: any) => select ? { runId: s.run.id, attemptId: s.attempt.id } : { ...s.candidate, attempt: { ...s.attempt, endedAt: new Date(s.attempt.endedAt) }, run: s.run, evidence: s.evidence, diffs: s.diffs } },
    ingestionAttempt: { findMany: async () => latest },
    novaRockContentSeal: {
      findUnique: async () => seal,
      findUniqueOrThrow: async () => { if (!seal) throw new Error("Missing seal"); return seal; },
      create: async ({ data }: any) => { seal = { id: "seal", ...data }; return seal; },
    },
  };
  const db = { $transaction: async (fn: any, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    assert.equal(options.timeout, 10000);
    return fn(tx);
  } } as any;
  return { db, s, latest: (rows: any[]) => { latest = rows; }, seal: () => seal, lockCount: () => lockCount };
}

test("transaction seal replays only exact content; fresh reader reports NONE and revalidates", async () => {
  const d = databaseDouble();
  const seal = await sealNovaRockContent(d.db, "candidate");
  assert.equal((await sealNovaRockContent(d.db, "candidate")).id, seal.id);
  assert.equal((await verifyNovaRockContentSeal(d.db, seal.id)).authority, "NONE");
  assert.equal(d.lockCount(), 9);
  d.s.diffs[0].reviewRequired = !d.s.diffs[0].reviewRequired;
  await assert.rejects(verifyNovaRockContentSeal(d.db, seal.id), /mismatch/);
});

test("reader rejects altered seal, later failed/placeholder attempts and tied attempts", async () => {
  const d = databaseDouble();
  const seal = await sealNovaRockContent(d.db, "candidate");
  d.seal().snapshot.extra = true;
  await assert.rejects(verifyNovaRockContentSeal(d.db, seal.id), /mismatch/);
  delete d.seal().snapshot.extra;
  d.latest([{ id: "later-failed", endedAt: new Date("2026-10-09") }]);
  await assert.rejects(verifyNovaRockContentSeal(d.db, seal.id), /Historical/);
  await assert.rejects(sealNovaRockContent(d.db, "candidate"), /Historical/);
  d.latest([{ id: d.s.attempt.id, endedAt: new Date(d.s.attempt.endedAt) }, { id: "tied-placeholder", endedAt: new Date(d.s.attempt.endedAt) }]);
  await assert.rejects(verifyNovaRockContentSeal(d.db, seal.id), /ambiguous/);
});


test("seal creation requires PENDING, independently of immutable digest and caller lifecycle text", async () => {
  for (const state of ["APPROVED", "PUBLISHED", "REJECTED"]) {
    const d = databaseDouble();
    d.s.candidate.reviewState = state;
    await assert.rejects(sealNovaRockContent(d.db, "candidate"), /requires PENDING/);
    assert.equal(d.seal(), null);
  }
});

test("lifecycle-only changes preserve seal and replay; enum/actor text grants no authority", async () => {
  const d = databaseDouble();
  const seal = await sealNovaRockContent(d.db, "candidate");
  const expected = { sealId: seal.id, candidateId: "candidate", contentDigest: seal.contentDigest, authority: "NONE" };
  for (const state of ["APPROVED", "PUBLISHED"]) {
    Object.assign(d.s.candidate, { reviewState: state, reviewActor: "untrusted-test-text",
      reviewedAt: "2026-10-09T00:00:00.000Z", publishedAt: "2026-10-10T00:00:00.000Z", catalogueVersion: "test-only" });
    assert.deepEqual(await verifyNovaRockContentSeal(d.db, seal.id), expected);
    assert.equal((await sealNovaRockContent(d.db, "candidate")).id, seal.id);
  }
  for (const key of ["reviewState", "reviewActor", "reviewedAt", "publishedAt", "catalogueVersion"]) {
    assert.equal(Object.hasOwn(digestNovaRockContent(seal.snapshot).snapshot.candidate, key), false);
  }
});

test("reader still rejects normalized/warnings/lineage changes after lifecycle updates", async () => {
  for (const change of [
    (s: any) => { s.candidate.normalized.lineup[39] = "Changed later name";
      s.evidence.find((e: any) => e.field === "lineup").observedValue[39] = "Changed later name"; },
    (s: any) => { s.candidate.warnings.push("changed"); s.candidate.normalized.warnings.push("changed"); },
    (s: any) => { s.candidate.attemptId = "replaced"; },
    (s: any) => { s.candidate.runId = "replaced"; },
  ]) {
    const d = databaseDouble();
    const seal = await sealNovaRockContent(d.db, "candidate");
    d.s.candidate.reviewState = "APPROVED";
    change(d.s);
    await assert.rejects(verifyNovaRockContentSeal(d.db, seal.id), /mismatch|lineage/);
  }
});
