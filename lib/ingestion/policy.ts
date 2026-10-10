import type { Festival } from "../domain/festival.ts";
import type { FestivalCandidate, IngestionResult } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";
import { diffFestival } from "./diff.ts";

export function evaluateCandidate(current: Festival, candidate: FestivalCandidate): IngestionResult {
  // The Rockharz "announced so far" grid includes headliners without marking
  // their billing. Reconcile against independently reviewed catalogue names,
  // not a fixed bill: known headliners must not be demoted or added twice.
  // Truly new captions still require artist review before provider activity.
  const rockharzGrid = current.slug === "rockharz" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://www.rockharz-festival.com/bands" && current.editionYear === 2027 &&
    candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === 2027 &&
    candidate.artistListMode === "additive" && candidate.evidence.some(e => e.field === "lineup");
  const reviewedNames = new Set([...current.headliners, ...current.lineup].map(name => name.toLocaleLowerCase()));
  const reviewedHeadliners = new Set(current.headliners.map(name => name.toLocaleLowerCase()));
  const effective = rockharzGrid ? { ...candidate,
    lineup: candidate.lineup?.filter(name => !reviewedHeadliners.has(name.toLocaleLowerCase())) } : candidate;
  const changes = diffFestival(current, effective);
  const warnings = candidate.warnings.filter(warning => !(rockharzGrid &&
    warning.startsWith("New Rockharz captions are provisional and require independent artist review:") &&
    candidate.lineup?.every(name => reviewedNames.has(name.toLocaleLowerCase()))));
  if (rockharzGrid) effective.warnings = warnings;
  const reviewReasons = new Set(warnings);
  if (candidate.festivalSlug !== current.slug) reviewReasons.add("Candidate slug does not match the current festival");
  const catalogueYear = current.editionYear ?? (current.startDate ? Number(current.startDate.slice(0, 4)) : undefined);
  const mismatchedYears = catalogueYear ? candidate.observedEditionYears.filter((year) => year !== catalogueYear) : [];
  if (mismatchedYears.length) reviewReasons.add(`Candidate edition ${mismatchedYears.join(", ")} does not match catalogue edition ${catalogueYear}`);
  if (candidate.lineup && candidate.lineup.length > 0 && !catalogueYear) reviewReasons.add("Catalogue edition year is unknown; lineup requires review");
  if (candidate.lineup && candidate.lineup.length > 0 && candidate.observedEditionYears.length === 0) reviewReasons.add("Lineup edition could not be verified against the catalogue year");
  if (candidate.lineup && candidate.lineup.length === 0 && current.lineup.length > 0) reviewReasons.add("A non-empty lineup cannot be replaced by an empty lineup");
  changes.filter((change) => change.reviewRequired).forEach((change) => reviewReasons.add(change.reason || `${change.kind} requires review`));
  return { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: current.slug, sourceUrl: candidate.sourceUrl, fetchedAt: candidate.fetchedAt, changes, candidate: effective, publishable: changes.length > 0 && reviewReasons.size === 0, reviewReasons: [...reviewReasons] };
}
