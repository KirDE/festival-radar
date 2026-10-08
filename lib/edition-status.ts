import type { FestivalEdition } from "./domain/edition.ts";

type EditionStatusFacts = Pick<FestivalEdition, "completeness" | "startDate" | "endDate" | "headliners" | "lineup">;

export function editionStatusLabel(edition: EditionStatusFacts): string {
  if (edition.completeness !== "tba") return `${edition.completeness} record`;

  // Published facts can outpace completeness metadata. They establish a partial
  // public record, but never establish that the lineup is complete.
  const hasPublishedFacts = Boolean(edition.startDate || edition.endDate || edition.headliners.length || edition.lineup.length);
  return hasPublishedFacts ? "partial record" : "Official dates and lineup TBA";
}
