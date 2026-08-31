import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createIngestionRun, finishIngestionRun, ingestionQueries, persistAttempt } from "../lib/ingestion/repository.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for ingestion repository E2E tests");
const db = new PrismaClient();
const suffix = `${Date.now()}-${process.pid}`;
const slug = `repository-e2e-${suffix}`;
const now = new Date();
let runId;
const createdRunIds = [];

async function cleanup() {
  if (!createdRunIds.length) return;
  const candidates = await db.ingestionCandidate.findMany({ where: { runId: { in: createdRunIds } }, select: { id: true } });
  const candidateIds = candidates.map(({ id }) => id);
  await db.ingestionDiff.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await db.ingestionEvidence.deleteMany({ where: { candidateId: { in: candidateIds } } });
  await db.ingestionCandidate.deleteMany({ where: { id: { in: candidateIds } } });
  await db.ingestionAttempt.deleteMany({ where: { runId: { in: createdRunIds } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.ingestionSourceState.deleteMany({ where: { festivalSlug: slug } });
}

after(async () => {
  await cleanup();
  await db.$disconnect();
});

const result = (startDate, publishable = false, reviewReasons = []) => ({
  schemaVersion: 1,
  festivalSlug: slug,
  sourceUrl: "https://example.test/festival",
  fetchedAt: now.toISOString(),
  changes: [{ kind: "date_changed", field: "startDate", before: "2027-06-01", after: startDate, reviewRequired: reviewReasons.length > 0 }],
  candidate: {
    schemaVersion: 1, festivalSlug: slug, sourceUrl: "https://example.test/festival", fetchedAt: now.toISOString(),
    startDate, evidence: [{ field: "startDate", sourceUrl: "https://example.test/festival", observedAt: now.toISOString(), excerpt: `date ${startDate}` }], warnings: [],
  },
  publishable,
  reviewReasons,
});

test("persists partial failure, retry lineage and immutable candidate history", async () => {
  const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "e2e", totalSources: 2 });
  runId = run.id;
  createdRunIds.push(run.id);
  const failed = await persistAttempt(db, { runId, festivalSlug: slug, requestedUrl: "https://example.test/festival", durationMs: 5, startedAt: now, endedAt: now, error: "HTTP 503" });
  const retried = await persistAttempt(db, { runId, festivalSlug: slug, requestedUrl: "https://example.test/festival", finalUrl: "https://example.test/festival", httpStatus: 200, durationMs: 8, retryCount: 1, startedAt: now, endedAt: new Date(now.getTime() + 1_000), result: result("2027-06-02", false, ["date requires review"]) });
  assert.equal(retried.priorAttemptId, failed.id);
  const finished = await finishIngestionRun(db, runId);
  assert.equal(finished.status, "PARTIAL");
  assert.equal(finished.failed, 1);
  assert.equal(finished.successful, 1);

  const nextRun = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "e2e-2", totalSources: 1 });
  createdRunIds.push(nextRun.id);
  const second = await persistAttempt(db, { runId: nextRun.id, festivalSlug: slug, requestedUrl: "https://example.test/festival", httpStatus: 200, durationMs: 4, startedAt: now, endedAt: new Date(now.getTime() + 2_000), result: result("2027-06-03", true) });
  await finishIngestionRun(db, nextRun.id);

  const latest = await ingestionQueries.latestResult(db, slug);
  const candidates = await ingestionQueries.candidateHistory(db, slug);
  const diffs = await ingestionQueries.diffHistory(db, slug);
  const runs = await ingestionQueries.runHistory(db, 10);
  const states = await ingestionQueries.sourceStates(db);
  assert.equal(latest.id, second.id);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].supersedesId, candidates[1].id);
  assert.equal(diffs.length, 2);
  assert.ok(runs.some(({ id }) => id === runId));
  assert.equal(states.find((state) => state.festivalSlug === slug).lastSuccessfulCheck.toISOString(), new Date(now.getTime() + 2_000).toISOString());

});
