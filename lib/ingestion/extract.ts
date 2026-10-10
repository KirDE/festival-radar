import { extractFrequencyCandidate } from "./adapters/frequency.ts";
import { isFullForceArchivedEdition } from "./adapters/full-force-archive.ts";
import { extractHtmlFallbackCandidate } from "./adapters/html-fallback.ts";
import { extractJsonLdCandidate } from "./adapters/json-ld.ts";
import { extractOfficialMarkupCandidate } from "./adapters/official-markup.ts";
import { isArchivedRockEnSeineDocument } from "./adapters/rock-en-seine.ts";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";

const supportedFields: FieldEvidence["field"][] = ["startDate", "endDate", "city", "headliners", "lineup", "ticketsUrl", "status", "ticketStatus"];

export function extractFestivalCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  if (source.strategies.includes("html_fallback")) {
    const frequency = extractFrequencyCandidate(html, source, fetchedAt);
    if (frequency) return frequency;
  }
  // A successful probe of an explicitly archived edition is a no-op, not a
  // fresh ticket proposal or another agent review. A current JSON-LD Event
  // takes precedence when the publisher has not yet refreshed its page title.
  if (source.festivalSlug === "rock-en-seine" && source.strategies.includes("html_fallback") && isArchivedRockEnSeineDocument(html, source.editionYear)) {
    const event = source.strategies.includes("json_ld_event") ? extractJsonLdCandidate(html, source, fetchedAt) : undefined;
    if (event?.observedEditionYears.includes(source.editionYear)) return event;
    return {
      schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
      sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [],
    };
  }
  const candidates = source.strategies.flatMap((strategy) => {
    if (strategy === "json_ld_event") return [extractJsonLdCandidate(html, source, fetchedAt)];
    if (strategy === "html_fallback") return [extractHtmlFallbackCandidate(html, source, fetchedAt)];
    if (strategy === "official_markup") return [extractOfficialMarkupCandidate(html, source, fetchedAt)];
    if (strategy === "manual_review" && isFullForceArchivedEdition(html, source)) return [{ schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] }];
    if (strategy === "manual_review") return [{ schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [`Manual review only: ${source.manualReviewReason ?? "no trustworthy automated extraction path"}`], observedEditionYears: [] }];
    return [];
  });
  const merged: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
    observedEditionYears: [],
  };
  for (const candidate of candidates) {
    if (candidate.artistListMode) merged.artistListMode = candidate.artistListMode;
    for (const field of supportedFields) {
      if (merged[field] === undefined && candidate[field] !== undefined) Object.assign(merged, { [field]: candidate[field] });
    }
    merged.evidence.push(...candidate.evidence.filter(({ field }) => merged[field] !== undefined));
    merged.observedEditionYears.push(...candidate.observedEditionYears);
    merged.warnings.push(...candidate.warnings);
  }
  // Strategies are alternatives: an absent optional format is not a review
  // failure once another strategy supplied supported field evidence. Keep
  // all semantic warnings (edition drift, cancellations, lineup quality).
  const missingFormatWarnings = new Set([
    "No JSON-LD Event was found",
    "HTML fallback did not find explicitly marked festival fields",
  ]);
  if (merged.evidence.length > 0) {
    merged.warnings = merged.warnings.filter((warning) => !missingFormatWarnings.has(warning));
  }
  merged.evidence = merged.evidence.filter(({ field }, index, values) => values.findIndex((evidence) => evidence.field === field) === index);
  merged.observedEditionYears = [...new Set(merged.observedEditionYears)];
  merged.warnings = [...new Set(merged.warnings)];
  // The JSON-LD format is optional for the verified Rock Werchter homepage.
  // Keep every actual parse/edition warning, and no-field cases still review.
  if (source.festivalSlug === "rock-werchter" && merged.artistListMode === "additive" && merged.startDate && merged.endDate) {
    merged.warnings = merged.warnings.filter(warning => warning !== "No JSON-LD Event was found");
  }
  return merged;
}
