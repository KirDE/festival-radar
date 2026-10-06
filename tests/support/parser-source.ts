import type { FestivalSource } from "../../lib/ingestion/types.ts";
/** Synthetic configuration; slug selects the adapter, never a live source URL. */
export function parserSource(festivalSlug: string, overrides: Partial<FestivalSource> = {}): FestivalSource {
  return { festivalSlug, url: "https://source.example.test/", editionYear: 2027,
    strategies: ["official_markup"], refreshPolicy: "daily", enabled: true, ...overrides };
}
