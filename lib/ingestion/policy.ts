import type { Festival } from "../../data/festivals.ts";
import type { FestivalCandidate, IngestionResult } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";
import { diffFestival } from "./diff.ts";

export function evaluateCandidate(current: Festival, candidate: FestivalCandidate): IngestionResult {
  const changes = diffFestival(current, candidate);
  const reviewReasons = new Set(candidate.warnings);
  if (candidate.festivalSlug !== current.slug) reviewReasons.add("Candidate slug does not match the current festival");
  if (candidate.lineup && candidate.lineup.length === 0 && current.lineup.length > 0) reviewReasons.add("A non-empty lineup cannot be replaced by an empty lineup");
  changes.filter((change) => change.reviewRequired).forEach((change) => reviewReasons.add(change.reason || `${change.kind} requires review`));
  return { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: current.slug, sourceUrl: candidate.sourceUrl, fetchedAt: candidate.fetchedAt, changes, candidate, publishable: changes.length > 0 && reviewReasons.size === 0, reviewReasons: [...reviewReasons] };
}
