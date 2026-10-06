import type { Festival, PlaylistStatus } from "../../lib/domain/festival.ts";
import type { FestivalEdition } from "../../lib/domain/edition.ts";
import type { ArtistProfile } from "../../lib/domain/artist.ts";
export type CatalogSeed = { festivals: Festival[]; editions: FestivalEdition[]; artists: ArtistProfile[]; playlists: Record<string, PlaylistStatus> };
export const festival: Festival = {
  slug: "synthetic-fest", name: "Synthetic Fest", country: "Testland", countryCode: "DE",
  city: "Sample City", officialUrl: "https://festival.example.test/", startDate: "2027-06-10", endDate: "2027-06-12",
  headliners: ["Sample Artist"], lineup: [], status: "confirmed", ticketStatus: "unknown",
  updatedAt: "2026-01-01T00:00:00.000Z", genres: ["doom metal"], coordinates: { latitude: 50, longitude: 10 }, editionYear: 2027,
};
export const artist: ArtistProfile = {
  slug: "sample-artist", name: "Sample Artist", aliases: [], genres: [], biography: "Fictional artist for localization tests.", identities: {}, identityState: "unresolved",
  links: [], topTracks: [], recentSetlists: [{ date: "2026-02-01", venue: "Sample Hall", url: "https://setlist.example.test/sample" }], provenance: [], freshness: Object.fromEntries(["profile", "music", "setlists"].map(key => [key, { checkedAt: "2026-01-01", refreshAfter: "2026-04-01", cadenceDays: 90 }])) as ArtistProfile["freshness"],
};
export const catalogSeed: CatalogSeed = {
  festivals: [festival], artists: [artist], playlists: {},
  editions: [
    { ...festival, editionYear: 2026, headliners: [], lineup: [], recordState: "archived", completeness: "complete", snapshotAt: "2026-01-01T00:00:00Z", provenance: [] },
    { ...festival, editionYear: 2027, recordState: "current", completeness: "complete", provenance: [] },
  ],
};
