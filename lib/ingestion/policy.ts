import type { Festival } from "../domain/festival.ts";
import type { FestivalCandidate, IngestionResult } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";
import { diffFestival } from "./diff.ts";

export function evaluateCandidate(current: Festival, candidate: FestivalCandidate): IngestionResult {
  // A first-wave ticket article cannot remove later reviewed artists or change
  // their billing. Quiet only the known bill, never a newly announced identity.
  const rockstadtAnnouncement = current.slug === "rockstadt" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/" &&
    current.editionYear === 2027 && candidate.observedEditionYears.length === 1 &&
    candidate.observedEditionYears[0] === 2027 && candidate.artistListMode === "additive" &&
    candidate.evidence.some(item => item.field === "lineup");
  const known = new Set([...current.headliners, ...current.lineup].map(name => name.toLocaleLowerCase()));
  const headliners = new Set(current.headliners.map(name => name.toLocaleLowerCase()));
  const effective = rockstadtAnnouncement ? { ...candidate,
    status: current.status === "confirmed" ? current.status : candidate.status,
    lineup: candidate.lineup?.filter(name => !headliners.has(name.toLocaleLowerCase())),
    warnings: candidate.warnings.filter(warning => !(warning === "Agent review required before lineup-triggered provider activity" &&
      candidate.lineup?.every(name => known.has(name.toLocaleLowerCase())))) } : candidate;
  const changes = diffFestival(current, effective);
  const reviewReasons = new Set(effective.warnings);
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
