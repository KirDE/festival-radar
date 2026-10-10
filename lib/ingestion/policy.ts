import { IDAYS_ARTIST_REVIEW } from "./adapters/idays.ts";
import type { Festival } from "../domain/festival.ts";
import type { FestivalCandidate, IngestionResult } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";
import { diffFestival } from "./diff.ts";

export function evaluateCandidate(current: Festival, candidate: FestivalCandidate): IngestionResult {
  // An incomplete I-Days announcement cannot downgrade a verified full bill.
  if (candidate.festivalSlug === "idays" && candidate.artistListMode === "additive" && candidate.status === "partial" && current.status === "confirmed") candidate = { ...candidate, status: undefined };
  // Additive first-wave pages do not redefine independently reviewed billing.
  // Scope each reconciliation to its own registered source and edition.
  const rockstadtAnnouncement = current.slug === "rockstadt" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/" &&
    current.editionYear === 2027 && candidate.observedEditionYears.length === 1 &&
    candidate.observedEditionYears[0] === 2027 && candidate.artistListMode === "additive" &&
    candidate.evidence.some(item => item.field === "lineup");
  const rockharzGrid = current.slug === "rockharz" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://www.rockharz-festival.com/bands" && current.editionYear === 2027 &&
    candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === 2027 &&
    candidate.artistListMode === "additive" && candidate.evidence.some(e => e.field === "lineup");
  const reviewedNames = new Set([...current.headliners, ...current.lineup].map(name => name.toLocaleLowerCase()));
  const reviewedHeadliners = new Set(current.headliners.map(name => name.toLocaleLowerCase()));
  const reconcileBilling = rockstadtAnnouncement || rockharzGrid;
  const warnings = candidate.warnings.filter(warning => !(candidate.lineup?.every(name => reviewedNames.has(name.toLocaleLowerCase())) &&
    ((rockstadtAnnouncement && warning === "Agent review required before lineup-triggered provider activity") ||
     (rockharzGrid && warning.startsWith("New Rockharz captions are provisional and require independent artist review:")))));
  const effective = reconcileBilling ? { ...candidate,
    ...(rockstadtAnnouncement && current.status === "confirmed" ? { status: current.status } : {}),
    lineup: candidate.lineup?.filter(name => !reviewedHeadliners.has(name.toLocaleLowerCase())),
    warnings } : candidate;
  const changes = diffFestival(current, effective);
  const unchangedIdays = candidate.festivalSlug === "idays" && !changes.some(change => ["lineup", "headliners"].includes(change.field));
  const reviewReasons = new Set(warnings.filter(warning => !(unchangedIdays && warning === IDAYS_ARTIST_REVIEW)));
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
