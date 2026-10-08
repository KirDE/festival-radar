import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";
import { createIngestionRun, persistAttempt, finishIngestionRun } from "../lib/ingestion/repository.ts";
import { digestNovaRockContent, sealNovaRockContent, verifyNovaRockContentSeal } from "../lib/ingestion/novarock-content-seal.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
// Intentionally retain append-only fixtures; discard the entire disposable DB after this suite.
test("PostgreSQL permits lifecycle-only transitions, freezes content and rejects later failed attempts", async () => {
  try {
    assert.equal(await db.ingestionAttempt.count(), 0, "requires empty migrated disposable DB");
    const queues = await db.catalogPlaylistRefresh.count();
    const publications = await db.catalogPublication.count();
    const { result, provenance } = novaContentFixture();
    const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-unattested", totalSources: 1 });
    const input = { runId: run.id, festivalSlug: "nova-rock", requestedUrl: provenance.configuration.url, finalUrl: provenance.configuration.url,
      httpStatus: 200, durationMs: 1, startedAt: new Date("2026-10-08T00:00:00Z"), endedAt: new Date("2026-10-08T00:00:01Z"), acquisitionProvenance: provenance };
    const attempt = await persistAttempt(db, { ...input, result });
    const candidate = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id }, include: { evidence: true, diffs: true } });
    await assert.rejects(sealNovaRockContent(db, candidate.id), /Zod|Invalid|expected/i, "unfinished run fails closed");
    await finishIngestionRun(db, run.id);
    const persisted = await db.ingestionCandidate.findUniqueOrThrow({ where: { id: candidate.id }, include: { attempt: true, run: true, evidence: true, diffs: true } });
    const { attempt: persistedAttempt, run: persistedRun, evidence: persistedEvidence, diffs: persistedDiffs,
      reviewState: _state, reviewActor: _actor, reviewedAt: _reviewedAt, publishedAt: _publishedAt,
      catalogueVersion: _version, ...immutableCandidate } = persisted;
    const content = digestNovaRockContent(JSON.parse(JSON.stringify({ version: 1, candidate: immutableCandidate,
      attempt: persistedAttempt, run: persistedRun, evidence: persistedEvidence, diffs: persistedDiffs })));
    // Synthetic enum transition only; no approval decision or catalogue publication.
    await db.ingestionCandidate.update({ where: { id: candidate.id }, data: { reviewState: "APPROVED" } });
    await assert.rejects(sealNovaRockContent(db, candidate.id), /requires PENDING/);
    await assert.rejects(db.novaRockContentSeal.create({ data: { candidateId: candidate.id, version: 1,
      contentDigest: content.contentDigest, snapshot: content.snapshot as any } }), /requires PENDING/);
    assert.equal(await db.novaRockContentSeal.count(), 0);
    await db.ingestionCandidate.update({ where: { id: candidate.id }, data: { reviewState: "PENDING" } });
    const contenders = await Promise.allSettled([
      sealNovaRockContent(db, candidate.id), sealNovaRockContent(db, candidate.id),
    ]);
    assert.ok(contenders.some((outcome) => outcome.status === "fulfilled"));
    for (const outcome of contenders) if (outcome.status === "rejected") {
      assert.ok(["P2034", "P2002"].includes(outcome.reason.code), "only serialization/unique race rejection is allowed");
    }
    assert.equal(await db.novaRockContentSeal.count(), 1);
    const seal = await sealNovaRockContent(db, candidate.id);
    assert.equal((await sealNovaRockContent(db, candidate.id)).id, seal.id);
    assert.deepEqual(await verifyNovaRockContentSeal(db, seal.id), { sealId: seal.id, candidateId: candidate.id, contentDigest: seal.contentDigest, authority: "NONE" });
    await assert.rejects(db.novaRockContentSeal.create({ data: { candidateId: candidate.id, version: 1, contentDigest: seal.contentDigest, snapshot: seal.snapshot as any } }), /Unique constraint/);
    const expected = { sealId: seal.id, candidateId: candidate.id, contentDigest: seal.contentDigest, authority: "NONE" };
    // An enum flip alone never adds authority.
    await db.ingestionCandidate.update({ where: { id: candidate.id }, data: { reviewState: "APPROVED" } });
    assert.deepEqual(await verifyNovaRockContentSeal(db, seal.id), expected);
    assert.equal((await sealNovaRockContent(db, candidate.id)).id, seal.id);
    // Exercise all five excluded columns on disposable synthetic data only.
    await db.ingestionCandidate.update({ where: { id: candidate.id }, data: {
      reviewState: "PUBLISHED", reviewActor: "untrusted-test-text", reviewedAt: new Date("2026-10-09T00:00:00Z"),
      publishedAt: new Date("2026-10-10T00:00:00Z"), catalogueVersion: "synthetic-lifecycle-only",
    } });
    assert.deepEqual(await verifyNovaRockContentSeal(db, seal.id), expected);
    assert.equal((await sealNovaRockContent(db, candidate.id)).id, seal.id);
    const persistedSeal = await db.novaRockContentSeal.findUniqueOrThrow({ where: { id: seal.id } });
    assert.equal(persistedSeal.contentDigest, seal.contentDigest);
    assert.deepEqual(persistedSeal.snapshot, seal.snapshot);
    for (const key of ["reviewState", "reviewActor", "reviewedAt", "publishedAt", "catalogueVersion"]) {
      assert.equal(Object.hasOwn((seal.snapshot as any).candidate, key), false);
    }
    const evidence = candidate.evidence[0], diff = candidate.diffs[0];
    const reject = (action: Promise<unknown>) => assert.rejects(action, /immutable|append-only/);
    await reject(db.novaRockContentSeal.update({ where: { id: seal.id }, data: { contentDigest: "0".repeat(64) } }));
    await reject(db.novaRockContentSeal.delete({ where: { id: seal.id } }));
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { normalized: {} } }));
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { warnings: [] } }));
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { runId: "replaced-run" } }));
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { attemptId: "replaced-attempt" } }));
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { id: "replaced-candidate" } }));
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { publishable: true } }));
    // Lifecycle columns cannot camouflage a simultaneous sealed-content change.
    await reject(db.ingestionCandidate.update({ where: { id: candidate.id }, data: { reviewState: "APPROVED", warnings: [] } }));
    await reject(db.$executeRaw`UPDATE "IngestionCandidate" SET "reviewActor" = 'changed-test-text', normalized = '{}'::jsonb WHERE id = ${candidate.id}`);
    await reject(db.ingestionCandidate.delete({ where: { id: candidate.id } }));
    await reject(db.ingestionAttempt.update({ where: { id: attempt.id }, data: { acquisitionProvenance: {} } }));
    await reject(db.ingestionRun.update({ where: { id: run.id }, data: { sourceCommit: "replaced" } }));
    await reject(db.ingestionEvidence.update({ where: { id: evidence.id }, data: { observedValue: "changed later card" } }));
    await reject(db.ingestionEvidence.delete({ where: { id: evidence.id } }));
    const { id: _id, ...extraEvidence } = evidence;
    await reject(db.ingestionEvidence.create({ data: { ...extraEvidence, observedValue: extraEvidence.observedValue as any } }));
    await reject(db.ingestionDiff.update({ where: { id: diff.id }, data: { reviewRequired: false } }));
    await reject(db.ingestionDiff.delete({ where: { id: diff.id } }));
    const { id: _diffId, ...extraDiff } = diff;
    await reject(db.ingestionDiff.create({ data: { ...extraDiff, beforeValue: extraDiff.beforeValue as any, afterValue: extraDiff.afterValue as any } }));
    await reject(db.$executeRawUnsafe('TRUNCATE "NovaRockContentSeal"'));
    // A transaction error must leave the seal and original content intact.
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.ingestionSourceState.update({ where: { festivalSlug: "nova-rock" }, data: { lastSuccessfulCheck: new Date("2028-01-01") } });
      await tx.ingestionCandidate.update({ where: { id: candidate.id }, data: { reviewState: "APPROVED" } });
      await tx.ingestionCandidate.update({ where: { id: candidate.id }, data: { normalized: {} } });
    }), /immutable/);
    assert.notEqual((await db.ingestionSourceState.findUniqueOrThrow({ where: { festivalSlug: "nova-rock" } })).lastSuccessfulCheck?.getUTCFullYear(), 2028);
    assert.equal((await verifyNovaRockContentSeal(db, seal.id)).authority, "NONE");
    const laterRun = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-unattested", totalSources: 1 });
    await persistAttempt(db, { ...input, runId: laterRun.id, endedAt: new Date("2026-10-08T00:00:02Z"), error: "failed later acquisition" });
    await assert.rejects(verifyNovaRockContentSeal(db, seal.id), /Historical/);
    await assert.rejects(sealNovaRockContent(db, candidate.id), /Historical/);
    assert.equal(await db.novaRockContentSeal.count(), 1);
    assert.equal(await db.catalogPublication.count(), publications);
    assert.equal(await db.catalogPlaylistRefresh.count(), queues);
    const after = await db.ingestionCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    assert.equal(after.reviewState, "PUBLISHED", "failed content mutations roll back lifecycle changes too");
    assert.equal(after.reviewActor, "untrusted-test-text");
    assert.equal(after.catalogueVersion, "synthetic-lifecycle-only");
    assert.deepEqual(after.normalized, candidate.normalized);
    assert.deepEqual(after.warnings, candidate.warnings);
    assert.equal(after.runId, candidate.runId);
    assert.equal(after.attemptId, candidate.attemptId);
  } finally { await db.$disconnect(); }
});
