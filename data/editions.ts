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
  updatedAt: "2026-08-30T00:00:00Z",
  genres: ["metal"],
  editionYear: 2026,
  recordState: "archived",
  completeness: "partial",
  snapshotAt: "2026-08-30T00:00:00Z",
  provenance: Object.freeze([
    Object.freeze({ field: "dates", url: "https://www.wacken.com/en/news-details/here-is-the-first-running-order-for-woa-2026/", checkedAt: "2026-08-30T00:00:00Z", note: "Official 2026 running-order publication." }),
    Object.freeze({ field: "lineup", url: "https://www.wacken.com/en/news-details/here-is-the-first-running-order-for-woa-2026/", checkedAt: "2026-08-30T00:00:00Z", note: "Representative archived bill; intentionally not presented as complete." }),
  ]),
});

const ABSENCE_ONLY_EVIDENCE = /\b(?:no|nothing|tba|unannounced|unconfirmed|not\s+(?:yet\s+)?(?:been\s+)?(?:announced|confirmed|published|established))\b/i;

function normalizedHostname(url: URL) {
  return url.hostname.toLocaleLowerCase().replace(/^www\./, "");
}

export function hasEditionSpecificOfficialEvidence(item: FestivalEdition) {
  if (item.recordState !== "tracking") return false;

  let officialSource: URL;
  try {
    officialSource = new URL(item.officialUrl);
  } catch {
    return false;
  }

  const yearPattern = new RegExp(`(^|[^0-9])${item.editionYear}([^0-9]|$)`);
  return item.provenance.some((source) => {
    if (source.field !== "edition" || ABSENCE_ONLY_EVIDENCE.test(source.note)) return false;

    try {
      const artifact = new URL(source.url);
      return artifact.protocol === "https:"
        && normalizedHostname(artifact) === normalizedHostname(officialSource)
        // Notes describe evidence; they are not evidence themselves. The durable
        // official artifact must identify the edition year in its own URL.
        && yearPattern.test(`${artifact.pathname}${artifact.search}${artifact.hash}`);
    } catch {
      return false;
    }
  });
}

export function publishableFutureEditions(items: readonly FestivalEdition[]) {
  return Object.freeze(items.filter(hasEditionSpecificOfficialEvidence));
}

const currentEditions: FestivalEdition[] = festivals.map((item) => ({
  ...item,
  editionYear: item.editionYear ?? 2027,
  recordState: "current",
  completeness: item.status === "confirmed" ? "complete" : item.status,
  provenance: Object.freeze([item.slug === "tolminator"
    ? { field: "dates", url: item.officialUrl, checkedAt: item.updatedAt, note: "Official 2027 homepage publishes 28 July–1 August 2027." }
    : { field: "edition", url: item.officialUrl, checkedAt: "2026-08-30T00:00:00Z", note: "Official festival source." }]),
}));

export const archivedEditions = Object.freeze([wacken2026]);
// Future editions belong here only after an official, edition-specific artifact
// explicitly establishes the year. A generic homepage or an absence-of-news
// check is a research watchlist signal, not evidence for a FestivalEdition.
export const trackedFutureEditions: readonly FestivalEdition[] = publishableFutureEditions([]);
export const festivalEditions: readonly FestivalEdition[] = Object.freeze([
  ...archivedEditions,
  ...currentEditions,
  ...trackedFutureEditions,
]);

export const editionYears = Object.freeze([...new Set(festivalEditions.map(({ editionYear }) => editionYear))].sort());
export function getEditionsForYear(year: number) { return festivalEditions.filter((item) => item.editionYear === year); }
export function getFestivalEdition(slug: string, year: number) { return festivalEditions.find((item) => item.slug === slug && item.editionYear === year); }
