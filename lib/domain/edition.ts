import type { Festival } from "./festival.ts";

export type EditionProvenance = Readonly<{
  field: "edition" | "dates" | "lineup";
  url: string;
  checkedAt: string;
  note: string;
}>;

export type FestivalEdition = Readonly<
  Omit<Festival, "editionYear" | "headliners" | "lineup" | "timetable"> & {
    headliners: readonly string[];
    lineup: readonly string[];
    timetable?: readonly Readonly<{ date: string; stage: string; start: string; artist: string }>[];
    editionYear: number;
    recordState: "archived" | "current" | "tracking";
    completeness: "complete" | "partial" | "tba";
    snapshotAt?: string;
    provenance: readonly EditionProvenance[];
  }
>;
