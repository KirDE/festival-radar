import { extractHtmlFallbackCandidate } from "./adapters/html-fallback.ts";
import { extractJsonLdCandidate } from "./adapters/json-ld.ts";
import { extractOfficialMarkupCandidate } from "./adapters/official-markup.ts";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";

const supportedFields: FieldEvidence["field"][] = ["startDate", "endDate", "city", "headliners", "lineup", "ticketsUrl", "status"];

export function extractFestivalCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidates = source.strategies.flatMap((strategy) => {
    if (strategy === "json_ld_event") return [extractJsonLdCandidate(html, source, fetchedAt)];
    if (strategy === "html_fallback") return [extractHtmlFallbackCandidate(html, source, fetchedAt)];
    if (strategy === "official_markup") return [extractOfficialMarkupCandidate(html, source, fetchedAt)];
    if (strategy === "manual_review") return [{ schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [`Manual review only: ${source.manualReviewReason ?? "no trustworthy automated extraction path"}`] }];
    return [];
  });
  const merged: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
  };
  for (const candidate of candidates) {
    for (const field of supportedFields) {
      if (merged[field] === undefined && candidate[field] !== undefined) Object.assign(merged, { [field]: candidate[field] });
    }
    merged.evidence.push(...candidate.evidence.filter(({ field }) => merged[field] !== undefined));
  }
  const hasEvidence = new Set(merged.evidence.map(({ field }) => field));
  merged.evidence = merged.evidence.filter(({ field }, index, values) => values.findIndex((evidence) => evidence.field === field) === index);
  if (hasEvidence.size === 0) merged.warnings = [...new Set(candidates.flatMap(({ warnings }) => warnings))];
  return merged;
}
