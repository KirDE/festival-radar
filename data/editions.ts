import { festivals, type Festival } from "./festivals.ts";

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

const wacken2026: FestivalEdition = Object.freeze({
  slug: "wacken-open-air",
  name: "Wacken Open Air",
  country: "Germany",
  countryCode: "DE",
  city: "Wacken",
  startDate: "2026-07-29",
  endDate: "2026-08-01",
  headliners: Object.freeze(["Def Leppard", "Powerwolf", "Savatage"]),
  lineup: Object.freeze(["Emperor", "In Flames", "Lamb of God", "Sepultura", "Triptykon"]),
  officialUrl: "https://www.wacken.com/",
  status: "partial",
  ticketStatus: "unavailable",
  editionYear: 2026,
  recordState: "archived",
  completeness: "partial",
  snapshotAt: "2026-08-30T00:00:00Z",
  provenance: Object.freeze([
    Object.freeze({ field: "dates", url: "https://www.wacken.com/en/news-details/here-is-the-first-running-order-for-woa-2026/", checkedAt: "2026-08-30T00:00:00Z", note: "Official 2026 running-order publication." }),
    Object.freeze({ field: "lineup", url: "https://www.wacken.com/en/news-details/here-is-the-first-running-order-for-woa-2026/", checkedAt: "2026-08-30T00:00:00Z", note: "Representative archived bill; intentionally not presented as complete." }),
  ]),
});

const wacken2028: FestivalEdition = Object.freeze({
  slug: "wacken-open-air",
  name: "Wacken Open Air",
  country: "Germany",
  countryCode: "DE",
  city: "Wacken",
  dateLabel: "Dates TBA",
  headliners: Object.freeze([]),
  lineup: Object.freeze([]),
  officialUrl: "https://www.wacken.com/en/",
  status: "tba",
  ticketStatus: "unknown",
  editionYear: 2028,
  recordState: "tracking",
  completeness: "tba",
  provenance: Object.freeze([
    Object.freeze({ field: "edition", url: "https://www.wacken.com/en/", checkedAt: "2026-08-30T00:00:00Z", note: "Official site checked; no 2028 dates or artists have been published, so this record exposes tracking state only." }),
  ]),
});

const currentEditions: FestivalEdition[] = festivals.map((item) => ({
  ...item,
  editionYear: item.editionYear ?? 2027,
  recordState: "current",
  completeness: item.status === "confirmed" ? "complete" : item.status,
  provenance: Object.freeze([{ field: "edition", url: item.officialUrl, checkedAt: "2026-08-30T00:00:00Z", note: "Official festival source." }]),
}));

export const archivedEditions = Object.freeze([wacken2026]);
export const trackedFutureEditions = Object.freeze([wacken2028]);
export const festivalEditions: readonly FestivalEdition[] = Object.freeze([
  ...archivedEditions,
  ...currentEditions,
  ...trackedFutureEditions,
]);

export const editionYears = Object.freeze([...new Set(festivalEditions.map(({ editionYear }) => editionYear))].sort());
export function getEditionsForYear(year: number) { return festivalEditions.filter((item) => item.editionYear === year); }
export function getFestivalEdition(slug: string, year: number) { return festivalEditions.find((item) => item.slug === slug && item.editionYear === year); }
