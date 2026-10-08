import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { captureAcquisitionProvenance } from "../../lib/ingestion/provenance.ts";
import { extractFestivalCandidate } from "../../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../../lib/ingestion/policy.ts";
import { INGESTION_POLICY_VERSION } from "../../lib/ingestion/repository.ts";

export function novaContentFixture() {
  const timestamp = "2026-10-08T00:00:00.000Z";
  const url = "https://www.novarock.at/lineup/";
  const provenance = captureAcquisitionProvenance({
    id: "source-fixture", festivalId: "festival-fixture", festivalSlug: "nova-rock", editionId: "edition-fixture", editionYear: 2027,
    edition: { festivalId: "festival-fixture", year: 2027, recordState: "CURRENT" }, url,
    parserKey: "official_markup:nova-rock", strategies: ["official_markup"], fetchUrl: null, followLinkPattern: null,
    requestHeaders: null, enabled: true, refreshPolicy: "daily", cadenceSeconds: 86400, manualReviewReason: null,
    configurationBackfilledAt: new Date(timestamp), configurationGeneration: 1, leaseVersion: 1,
    leaseOwner: "12345678-1234-4234-8234-123456789012", updatedAt: new Date(timestamp),
  } as any);
  const html = readFileSync(new URL("../fixtures/official-markup/novarock-lineup-2027.html", import.meta.url), "utf8");
  const normalized = extractFestivalCandidate(html, { festivalSlug: "nova-rock", url, strategies: ["official_markup"], refreshPolicy: "daily", enabled: true, editionYear: 2027 }, timestamp);
  const result = evaluateCandidate({ slug: "nova-rock", editionYear: 2027, startDate: "2027-06-10", endDate: "2027-06-12", headliners: ["Die Ärzte", "Motionless In White"], lineup: ["TBS"] } as any, normalized);
  const snapshot = {
    version: 1,
    candidate: { id: "candidate", attemptId: "attempt", runId: "run", festivalSlug: "nova-rock", schemaVersion: 1,
      sourceEdition: "2027-06-09", sourceYear: 2027, normalized, warnings: normalized.warnings, publishable: false,
      supersedesId: null, createdAt: timestamp },
    attempt: { id: "attempt", runId: "run", festivalSlug: "nova-rock", requestedUrl: url, finalUrl: url, httpStatus: 200,
      durationMs: 1, retryCount: 0, error: null, acquisitionProvenance: provenance, parserVersions: { extractor: 1 },
      status: "REVIEW", startedAt: timestamp, endedAt: timestamp, priorAttemptId: null },
    run: { id: "run", schemaVersion: 1, trigger: "TEST", sourceCommit: "synthetic-unattested", startedAt: timestamp, endedAt: timestamp,
      status: "COMPLETED", totalSources: 1, successful: 1, unchanged: 0, reviewRequired: 1, publishable: 0, failed: 0, createdAt: timestamp },
    evidence: normalized.evidence.map((e, i) => ({ id: `e${i}`, candidateId: "candidate", field: e.field,
      observedValue: normalized[e.field], sourceUrl: e.sourceUrl, excerpt: e.excerpt ?? null,
      contentHash: createHash("sha256").update(e.excerpt ?? JSON.stringify(normalized[e.field])).digest("hex"), observedAt: timestamp, adapter: "festival-extractor-v1" })),
    diffs: result.changes.map((d, i) => ({ id: `d${i}`, candidateId: "candidate", field: d.field, beforeValue: d.before ?? null,
      afterValue: d.after ?? null, reviewRequired: d.reviewRequired, policyVersion: INGESTION_POLICY_VERSION, createdAt: timestamp })),
  };
  return { snapshot, result, provenance };
}
