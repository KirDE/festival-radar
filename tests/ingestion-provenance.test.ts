import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimedSource } from "../lib/ingestion/lease.ts";
import { captureAcquisitionProvenance, readAcquisitionProvenance, acquisitionMatchesSource } from "../lib/ingestion/provenance.ts";
import { persistAttempt } from "../lib/ingestion/repository.ts";

const row = {
  id: "source-a", festivalId: "festival-a", festivalSlug: "nova-rock", editionId: "edition-a", editionYear: 2027,
  edition: { festivalId: "festival-a", year: 2027, recordState: "CURRENT" },
  url: "https://www.novarock.at/lineup/", parserKey: "official_markup:nova-rock", strategies: ["official_markup"],
  fetchUrl: null, followLinkPattern: null, requestHeaders: { accept: "text/html", "x-test": "fixture" },
  enabled: true, refreshPolicy: "daily", cadenceSeconds: 86400, manualReviewReason: null,
  configurationBackfilledAt: new Date("2026-10-01T00:00:00Z"), configurationGeneration: 1,
  leaseVersion: 1, leaseOwner: "12345678-1234-4234-8234-123456789012", updatedAt: new Date("2026-10-08T00:00:00Z"),
  nextRunAt: null, consecutiveFailures: 0, lastError: null, lastAttemptAt: null, lastSuccessAt: null,
  leaseExpiresAt: new Date(), httpEtag: null, httpLastModified: null, createdAt: new Date(),
} satisfies ClaimedSource;

test("digest binds configuration and identities, preserves strategy order, ignores operational timestamps", () => {
  const acquired = captureAcquisitionProvenance(row);
  const operational = { ...row, updatedAt: new Date(), nextRunAt: new Date(), leaseExpiresAt: new Date(), consecutiveFailures: 2, httpEtag: "changed" };
  assert.equal(captureAcquisitionProvenance(operational).configurationDigest, acquired.configurationDigest);
  assert.ok(acquisitionMatchesSource(acquired, operational));
  assert.ok(acquisitionMatchesSource(acquired, { ...operational, leaseOwner: null, leaseExpiresAt: null }));
  assert.equal(captureAcquisitionProvenance({ ...row, requestHeaders: { "x-test": "fixture", accept: "text/html" } }).configurationDigest, acquired.configurationDigest);
  for (const change of [
    { id: "source-b" }, { festivalId: "festival-b", edition: { ...row.edition!, festivalId: "festival-b" } },
    { editionId: "edition-b" }, { editionYear: 2028, edition: { ...row.edition!, year: 2028 } },
    { url: "https://www.novarock.at/" }, { parserKey: "other" }, { strategies: ["html_fallback", "official_markup"] },
    { fetchUrl: "https://example.test/" }, { followLinkPattern: "^/lineup/$" }, { requestHeaders: { accept: "changed" } },
    { cadenceSeconds: 1 }, { manualReviewReason: "new reason" }, { refreshPolicy: "weekly" },
    { configurationGeneration: 3 }, { leaseVersion: 2 }, { leaseOwner: "12345678-1234-4234-8234-123456789013" },
    { edition: { ...row.edition!, recordState: "ARCHIVED" } },
    { enabled: false },
  ]) assert.equal(acquisitionMatchesSource(acquired, { ...row, ...change }), false, JSON.stringify(change));
  const ordered = captureAcquisitionProvenance({ ...row, strategies: ["json_ld_event", "html_fallback"] });
  assert.notEqual(captureAcquisitionProvenance({ ...row, strategies: ["html_fallback", "json_ld_event"] }).configurationDigest, ordered.configurationDigest);
  assert.throws(() => captureAcquisitionProvenance({ ...row, edition: { ...row.edition!, year: 2028 } }), /binding/);
});

test("reader rejects historical, malformed, tampered and unsupported provenance", () => {
  const acquired = captureAcquisitionProvenance(row);
  assert.deepEqual(readAcquisitionProvenance(JSON.parse(JSON.stringify(acquired))), acquired);
  for (const value of [null, undefined, {}, { ...acquired, version: 2 }, { ...acquired, extra: true },
    { ...acquired, configuration: { ...acquired.configuration, url: "https://example.test/" } },
    { ...acquired, leaseVersion: 0 }, { ...acquired, configurationDigest: "0".repeat(64) }]) {
    assert.equal(readAcquisitionProvenance(value), null);
    assert.equal(acquisitionMatchesSource(value, row), false);
  }
});

test("producer persists detached claimed snapshot for success and failure; legacy stays null", async () => {
  const acquired = captureAcquisitionProvenance(row);
  const stored: any[] = [];
  const db = { $transaction: async (fn: any) => fn({ ingestionAttempt: {
    findFirst: async () => null, create: async ({ data }: any) => { stored.push(JSON.parse(JSON.stringify(data))); return data; },
  } }) } as any;
  const input = { runId: "run", festivalSlug: row.festivalSlug, requestedUrl: row.url, finalUrl: "https://www.novarock.at/redirected/", durationMs: 1, startedAt: new Date(), endedAt: new Date() };
  await persistAttempt(db, { ...input, acquisitionProvenance: acquired });
  await persistAttempt(db, { ...input, error: "HTTP 503", acquisitionProvenance: acquired });
  await persistAttempt(db, input);
  row.url = "https://example.test/after-fetch";
  for (const attempt of stored.slice(0, 2)) {
    assert.equal(attempt.acquisitionProvenance.configuration.url, input.requestedUrl);
    assert.equal(attempt.finalUrl, input.finalUrl);
    assert.deepEqual(readAcquisitionProvenance(attempt.acquisitionProvenance), acquired);
  }
  assert.equal(readAcquisitionProvenance(stored[2].acquisitionProvenance), null);
  await assert.rejects(persistAttempt(db, { ...input, requestedUrl: "https://wrong.test/", acquisitionProvenance: acquired }), /provenance/);
  assert.equal(stored.length, 3);
});

test("non-Nova successful producer keeps status, normalized candidate and policy flags", async () => {
  const acquired = captureAcquisitionProvenance({ ...row, festivalSlug: "synthetic", parserKey: "json_ld_event", strategies: ["json_ld_event"] });
  const candidate = { schemaVersion: 1, festivalSlug: "synthetic", sourceUrl: row.url, fetchedAt: new Date().toISOString(), observedEditionYears: [2027], startDate: "2027-06-09", warnings: [], evidence: [] };
  const result = { schemaVersion: 1, festivalSlug: "synthetic", sourceUrl: row.url, fetchedAt: candidate.fetchedAt, candidate, changes: [], publishable: true, reviewReasons: [] } as any;
  let storedCandidate: any;
  const db = { $transaction: async (fn: any) => fn({
    ingestionAttempt: { findFirst: async () => null, create: async ({ data }: any) => ({ id: "attempt", ...data }) },
    ingestionCandidate: { findFirst: async () => null, create: async ({ data }: any) => { storedCandidate = data; return { id: "candidate", ...data }; } },
    ingestionSourceState: { upsert: async () => undefined },
  }) } as any;
  const attempt = await persistAttempt(db, { runId: "run", festivalSlug: "synthetic", requestedUrl: row.url, durationMs: 1, startedAt: new Date(), endedAt: new Date(), result, acquisitionProvenance: acquired });
  assert.equal(attempt.status, "PUBLISHABLE");
  assert.equal(storedCandidate.publishable, true);
  assert.deepEqual(storedCandidate.normalized, candidate);
  assert.deepEqual(readAcquisitionProvenance(attempt.acquisitionProvenance), acquired);
});
