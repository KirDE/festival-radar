import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { claimDueSources } from "../lib/ingestion/lease.ts";
import { captureAcquisitionProvenance, readAcquisitionProvenance, acquisitionMatchesSource } from "../lib/ingestion/provenance.ts";
import { createIngestionRun, persistAttempt, ingestionQueries } from "../lib/ingestion/repository.ts";
import { mapSource } from "../lib/sources/repository.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();

test("PostgreSQL acquisition survives source swap/rebind; generation and reclaimed lease fail comparison", async () => {
  const queueBefore = await db.catalogPlaylistRefresh.count();
  const publicationsBefore = await db.catalogPublication.count();
  const fixture = await readFile(new URL("./fixtures/official-markup/novarock-lineup-2027.html", import.meta.url), "utf8");
  const festival = await db.festival.create({ data: { slug: "nova-rock", name: "Nova Rock Fixture", country: "Austria", countryCode: "AT", officialUrl: "https://www.novarock.at/", genres: [],
    editions: { create: [2027, 2028].map((year) => ({ year, status: "PARTIAL", ticketStatus: "UNKNOWN", recordState: year === 2027 ? "CURRENT" : "TRACKING", completeness: "PARTIAL", sourceUpdatedAt: new Date() })) } } });
  const editions = await db.festivalEdition.findMany({ where: { festivalId: festival.id }, orderBy: { year: "asc" } });
  const source = await db.festivalSource.create({ data: { festivalId: festival.id, festivalSlug: festival.slug, editionId: editions[0].id, editionYear: 2027,
    url: "https://www.novarock.at/lineup/", parserKey: "official_markup:nova-rock", strategies: ["official_markup"], enabled: true,
    refreshPolicy: "daily", cadenceSeconds: 86400, configurationBackfilledAt: new Date() } });
  const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "provenance-e2e", totalSources: 1 });
  try {
    const [claimed] = await claimDueSources(db, { owner: randomUUID(), now: new Date(), limit: 1, ttlMs: 30000 });
    assert.equal(claimed.id, source.id, "requires isolated empty migrated database");
    const acquired = captureAcquisitionProvenance(claimed);
    const input = { runId: run.id, festivalSlug: festival.slug, requestedUrl: claimed.url, finalUrl: claimed.url, durationMs: 1, startedAt: new Date(), endedAt: new Date(), acquisitionProvenance: acquired };
    const currentRow = () => db.festivalSource.findUniqueOrThrow({ where: { id: source.id }, include: { edition: { select: { festivalId: true, year: true, recordState: true } } } });
    await db.festivalSource.update({ where: { id: source.id }, data: { nextRunAt: new Date(), lastError: "fetch_error", updatedAt: new Date(Date.now() + 1000) } });
    assert.ok(acquisitionMatchesSource(acquired, await currentRow()), "schedule/health writes do not change configuration generation");
    // Raw SQL deliberately preserves updatedAt. Generation still records both edits.
    await db.$executeRaw`UPDATE "FestivalSource" SET url = 'https://www.novarock.at/' WHERE id = ${source.id}`;
    const replacement = await db.festivalSource.create({ data: {
      festivalId: source.festivalId, festivalSlug: source.festivalSlug, editionId: source.editionId, editionYear: source.editionYear,
      url: claimed.url, parserKey: source.parserKey, strategies: source.strategies, enabled: true,
      refreshPolicy: source.refreshPolicy, cadenceSeconds: source.cadenceSeconds, configurationBackfilledAt: source.configurationBackfilledAt,
    } });
    try {
      const [replacementClaim] = await claimDueSources(db, { owner: randomUUID(), now: new Date(), limit: 1, ttlMs: 30000 });
      assert.equal(replacementClaim.id, replacement.id);
      assert.equal(replacementClaim.url, acquired.configuration.url);
      assert.equal(acquisitionMatchesSource(acquired, replacementClaim), false, "same URL on a different source is not acquisition lineage");
    } finally { await db.festivalSource.delete({ where: { id: replacement.id } }); }
    await db.$executeRaw`UPDATE "FestivalSource" SET url = ${claimed.url} WHERE id = ${source.id}`;
    const swapped = await currentRow();
    assert.equal(swapped.configurationGeneration, claimed.configurationGeneration + 2);
    assert.equal(captureAcquisitionProvenance(swapped).configurationDigest, acquired.configurationDigest);
    assert.equal(acquisitionMatchesSource(acquired, swapped), false);
    const result = evaluateCandidate({ slug: "nova-rock", startDate: "2027-06-10", endDate: "2027-06-12", headliners: ["Die Ärzte", "Motionless In White"], lineup: ["TBS"] } as any,
      extractFestivalCandidate(fixture, mapSource(claimed), input.startedAt.toISOString()));
    assert.ok(result.reviewReasons.length);
    const attempt = await persistAttempt(db, { ...input, result });
    const read = await ingestionQueries.latestResult(db, festival.slug);
    assert.equal(read?.id, attempt.id);
    assert.equal(read?.status, "REVIEW");
    assert.deepEqual(readAcquisitionProvenance(read?.acquisitionProvenance), acquired);
    assert.equal(read?.candidate?.publishable, false);
    await db.festivalSource.update({ where: { id: source.id }, data: { editionId: editions[1].id, editionYear: 2028 } });
    assert.equal(acquisitionMatchesSource(acquired, await currentRow()), false);
    const failed = await persistAttempt(db, { ...input, result: undefined, error: "HTTP 503", finalUrl: undefined });
    assert.equal(failed.status, "FAILED");
    assert.deepEqual(readAcquisitionProvenance(failed.acquisitionProvenance), acquired);
    await db.festivalSource.update({ where: { id: source.id }, data: { editionId: claimed.editionId, editionYear: 2027, nextRunAt: null, leaseExpiresAt: new Date(Date.now() - 1000) } });
    const [reclaimed] = await claimDueSources(db, { owner: randomUUID(), now: new Date(), limit: 1, ttlMs: 30000 });
    assert.equal(reclaimed.leaseVersion, claimed.leaseVersion + 1);
    assert.equal(acquisitionMatchesSource(acquired, reclaimed), false);
    assert.deepEqual(readAcquisitionProvenance((await db.ingestionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).acquisitionProvenance), acquired);
    const historical = await persistAttempt(db, { ...input, acquisitionProvenance: undefined });
    assert.equal(readAcquisitionProvenance(historical.acquisitionProvenance), null);
    assert.equal(await db.catalogPlaylistRefresh.count(), queueBefore);
    assert.equal(await db.catalogPublication.count(), publicationsBefore);
  } finally {
    await db.ingestionCandidate.deleteMany({ where: { runId: run.id } });
    await db.ingestionRun.delete({ where: { id: run.id } });
    await db.ingestionSourceState.deleteMany({ where: { festivalSlug: festival.slug } });
    await db.festivalSource.delete({ where: { id: source.id } });
    await db.festival.delete({ where: { id: festival.id } });
    await db.$disconnect();
  }
});
