import { artistProfiles, type ArtistProfile } from "../../data/artists.ts";
import { festivalEditions } from "../../data/editions.ts";
import { festivalSources } from "../../data/festival-sources.ts";
import { artistSlug, festivals } from "../../data/festivals.ts";
import playlistStatusJson from "../../data/playlist-status.json" with { type: "json" };

type PlaylistStatus = {
  spotifyUrl: string;
  youtubeMusicUrl?: string;
  artists: number;
  tracks: number;
  updatedAt: string;
};

const playlistStatus = playlistStatusJson as Record<string, PlaylistStatus>;
const profileBySlug = new Map(artistProfiles.map((profile) => [profile.slug, profile]));

function emptyProfile(name: string): ArtistProfile {
  const checkedAt = "2026-08-28";
  const freshness = (cadenceDays: number) => ({
    checkedAt,
    cadenceDays,
    refreshAfter: new Date(Date.parse(`${checkedAt}T00:00:00Z`) + cadenceDays * 86_400_000)
      .toISOString()
      .slice(0, 10),
  });
  return {
    name,
    slug: artistSlug(name),
    aliases: [],
    genres: [],
    identities: {},
    identityState: "unresolved",
    links: [],
    topTracks: [],
    recentSetlists: [],
    provenance: [],
    freshness: { profile: freshness(90), music: freshness(14), setlists: freshness(7) },
  };
}

const everyArtistName = new Set<string>();
for (const edition of festivalEditions) {
  for (const name of [...edition.headliners, ...edition.lineup]) everyArtistName.add(name);
  for (const performance of edition.timetable || []) everyArtistName.add(performance.artist);
}

export const catalogSeed = {
  festivals,
  editions: festivalEditions,
  artists: [...everyArtistName]
    .map((name) => profileBySlug.get(artistSlug(name)) || emptyProfile(name))
    .sort((left, right) => left.slug.localeCompare(right.slug)),
  sources: festivalSources,
  playlists: playlistStatus,
} as const;

export type CatalogSeed = typeof catalogSeed;
