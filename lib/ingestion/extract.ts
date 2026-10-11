import { extractRoadburnCandidate } from "./adapters/roadburn.ts";
import { extractCopenhellCurrent } from "./adapters/copenhell-current.ts";
import { extractRockInRomaCandidate } from "./adapters/rock-in-roma.ts";
import { extractAlpenFlairCandidate } from './adapters/alpen-flair.ts';
import { extractInfernoCandidate } from "./adapters/inferno.ts";
import { extractFrequencyCandidate } from "./adapters/frequency.ts";
import { extractPaleoCandidate } from "./adapters/paleo.ts";
import { extractLeedsCandidate } from "./adapters/leeds.ts";
import { isFullForceArchivedEdition } from "./adapters/full-force-archive.ts";
import { extractReadingCandidate } from "./adapters/reading.ts";
import { isRockImperiumSource, extractRockImperiumCandidate } from "./adapters/rock-imperium.ts";
import { isMadCoolArchivedEdition } from "./adapters/mad-cool-archive.ts";
import { isPistoiaBluesArchivedEdition } from "./adapters/pistoia-blues-archive.ts";
import { extractHtmlFallbackCandidate } from "./adapters/html-fallback.ts";
import { extractJsonLdCandidate } from "./adapters/json-ld.ts";
import { extractOfficialMarkupCandidate } from "./adapters/official-markup.ts";
import { isArchivedRockEnSeineDocument } from "./adapters/rock-en-seine.ts";
import type { FestivalCandidate, FestivalSource, FieldEvidence } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";

const supportedFields: FieldEvidence["field"][] = ["startDate", "endDate", "city", "headliners", "lineup", "ticketsUrl", "status", "ticketStatus"];

export function extractFestivalCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const roadburn = extractRoadburnCandidate(html, source, fetchedAt);
  if (roadburn) return roadburn;
  const copenhell = extractCopenhellCurrent(html, source, fetchedAt);
  if (copenhell) return copenhell;
  if (isRockImperiumSource(source)) return extractRockImperiumCandidate(html, source, fetchedAt);
  // Summer Breeze's existing HTML source mixes archived news, a navigation filter
  // and current metadata. Its trusted fallback owns the result; generic Event or
  // container guesses must not overwrite verified partial artists/billing.
  if (source.festivalSlug === "summer-breeze" && source.strategies.includes("html_fallback"))
    return extractHtmlFallbackCandidate(html, source, fetchedAt);
  if (source.strategies.includes("html_fallback")) {
    const roma = extractRockInRomaCandidate(html, source, fetchedAt);
    if (roma) return roma;
    const alpen = extractAlpenFlairCandidate(html, source, fetchedAt);
    if (alpen) return alpen;
    const inferno = extractInfernoCandidate(html, source, fetchedAt);
    if (inferno) return inferno;
    const frequency = extractFrequencyCandidate(html, source, fetchedAt);
    if (frequency) return frequency;
    const paleo = extractPaleoCandidate(html, source, fetchedAt);
    if (paleo) return paleo;
    const leeds = extractLeedsCandidate(html, source, fetchedAt);
    if (leeds) return leeds;
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
  if (source.strategies.includes("html_fallback")) {
    const reading = extractReadingCandidate(html, source, fetchedAt);
    if (reading) return reading;
  }
  // Alcatraz mixes the current banner with an archived bill and ticket terms.
  // Its trusted fallback owns this existing source, not generic Event guesses.
  if (source.festivalSlug === "alcatraz" && source.strategies.includes("html_fallback"))
    return extractHtmlFallbackCandidate(html, source, fetchedAt);
  const candidates = source.strategies.flatMap((strategy) => {
    if (strategy === "json_ld_event") return [extractJsonLdCandidate(html, source, fetchedAt)];
    if (strategy === "html_fallback") return [extractHtmlFallbackCandidate(html, source, fetchedAt)];
    if (strategy === "official_markup") return [extractOfficialMarkupCandidate(html, source, fetchedAt)];
    if (strategy === "manual_review" && (isFullForceArchivedEdition(html, source) || isMadCoolArchivedEdition(html, source) || isPistoiaBluesArchivedEdition(html, source))) return [{ schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] }];
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
    if (candidate.lineupScope && merged.lineup === candidate.lineup) merged.lineupScope = candidate.lineupScope;
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
