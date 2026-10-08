import type { Festival } from "@/lib/domain/festival";

export type LineupSort = "official" | "alphabetical" | "chronological" | "popularity";

export function sortFestivalLineup(item: Pick<Festival, "lineup" | "timetable">, sort: LineupSort, locale: string,
  popularity: Readonly<Record<string, number | null | undefined>> = {}) {
  const first = new Map<string, string>();
  for (const entry of item.timetable ?? []) {
    if (entry.status !== "scheduled" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start)) continue;
    const date = new Date(`${entry.date}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== entry.date) continue;
    const time = `${entry.date}T${entry.start}`;
    if (!first.has(entry.artist) || time < first.get(entry.artist)!) first.set(entry.artist, time);
  }
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  const knownPopularity = (name: string) => {
    const value = popularity[name];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
  };
  return item.lineup.map((name, position) => ({ name, position })).sort((a, b) => {
    let order = 0;
    if (sort === "alphabetical") order = collator.compare(a.name, b.name);
    if (sort === "chronological") {
      const left = first.get(a.name), right = first.get(b.name);
      order = left === right ? 0 : left === undefined ? 1 : right === undefined ? -1 : left.localeCompare(right);
    }
    if (sort === "popularity") {
      const left = knownPopularity(a.name), right = knownPopularity(b.name);
      order = left === right ? 0 : left === null ? 1 : right === null ? -1 : right - left;
    }
    return order || a.position - b.position;
  }).map(({ name }) => name);
}

type FestivalLineup = Pick<Festival, "headliners" | "lineup">;

export function announcedArtists(item: FestivalLineup) {
  return [...item.headliners, ...item.lineup];
}

export function hasAnnouncedLineup(item: FestivalLineup) {
  return item.headliners.length + item.lineup.length > 0;
}

export function lineupPreviewArtists(item: FestivalLineup) {
  return item.headliners.length > 0 ? item.headliners : item.lineup;
}
