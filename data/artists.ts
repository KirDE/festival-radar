import { allArtists, artistSlug } from "./festivals.ts";

export type ArtistSource = "official" | "spotify" | "musicbrainz" | "setlist.fm" | "wikimedia";

export type ArtistFreshness = {
  checkedAt: string;
  refreshAfter: string;
  cadenceDays: number;
};

export type ArtistProfile = {
  name: string;
  slug: string;
  aliases: string[];
  origin?: string;
  genres: string[];
  biography?: string;
  image?: { url: string; alt: string; width: number; height: number };
  identities: { spotify?: string; musicbrainz?: string; setlistFm?: string };
  links: { label: string; url: string; source: ArtistSource; verified: boolean }[];
  topTracks: string[];
  recentSetlists: { date: string; venue: string; url: string }[];
  provenance: { field: string; source: ArtistSource; url: string; checkedAt: string }[];
  freshness: { profile: ArtistFreshness; music: ArtistFreshness; setlists: ArtistFreshness };
};

const checkedAt = "2026-08-28";

const curated: Record<string, Partial<ArtistProfile>> = {
  "electric-callboy": {
    aliases: ["Eskimo Callboy"],
    origin: "Castrop-Rauxel, Germany",
    genres: ["electronicore", "metalcore"],
    biography: "German electronicore band known for combining metalcore with electronic and dance music.",
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Electric_Callboy_%282024%29.jpg/960px-Electric_Callboy_%282024%29.jpg",
      alt: "Electric Callboy performing in 2024",
      width: 800,
      height: 600,
    },
    identities: {
      spotify: "5pz7f2hG2q2TuFovkw4Z0n",
      musicbrainz: "8e5d91df-ec18-4c9b-8d56-4f4039f03ae8",
      setlistFm: "8e5d91df-ec18-4c9b-8d56-4f4039f03ae8",
    },
    topTracks: ["Hypa Hypa", "We Got the Moves", "Pump It"],
    links: [
      { label: "Official site", url: "https://www.electriccallboy.com/", source: "official", verified: true },
      { label: "Instagram", url: "https://www.instagram.com/electriccallboy/", source: "official", verified: true },
      { label: "setlist.fm", url: "https://www.setlist.fm/setlists/electric-callboy-3bd5d8b0.html", source: "setlist.fm", verified: true },
    ],
    recentSetlists: [
      { date: "2026-08-01", venue: "Wacken Open Air, Wacken, Germany", url: "https://www.setlist.fm/setlists/electric-callboy-3bd5d8b0.html" },
    ],
    provenance: [
      {
        field: "image",
        source: "wikimedia",
        url: "https://commons.wikimedia.org/wiki/File:Electric_Callboy_(2024).jpg",
        checkedAt,
      },
    ],
  },
  halestorm: {
    origin: "Red Lion, Pennsylvania, United States",
    genres: ["hard rock", "alternative metal"],
    biography: "American hard rock band fronted by vocalist and guitarist Lzzy Hale.",
    identities: {
      spotify: "6om12Ev5ppgoMy3OYSoech",
      musicbrainz: "95ca1a93-2392-4c21-9c78-2cb161b080e6",
      setlistFm: "95ca1a93-2392-4c21-9c78-2cb161b080e6",
    },
    topTracks: ["I Miss the Misery", "Love Bites (So Do I)", "I Am the Fire"],
    links: [{ label: "Official site", url: "https://www.halestormrocks.com/", source: "official", verified: true }],
  },
  helloween: {
    origin: "Hamburg, Germany",
    genres: ["power metal", "heavy metal"],
    biography: "German power metal band formed in Hamburg in 1984.",
    identities: {
      spotify: "4pQN0GB0fNEEOfQCaWotsY",
      musicbrainz: "a5679add-31e5-45b1-9e94-4b1c3d9d9efb",
      setlistFm: "a5679add-31e5-45b1-9e94-4b1c3d9d9efb",
    },
    topTracks: ["I Want Out", "Future World", "Eagle Fly Free"],
    links: [{ label: "Official site", url: "https://www.helloween.org/", source: "official", verified: true }],
  },
};

function searchLinks(name: string): ArtistProfile["links"] {
  const query = encodeURIComponent(name);
  return [
    { label: "Search Spotify", url: `https://open.spotify.com/search/${query}`, source: "spotify", verified: false },
    { label: "Search MusicBrainz", url: `https://musicbrainz.org/search?query=${query}&type=artist`, source: "musicbrainz", verified: false },
    { label: "Search setlist.fm", url: `https://www.setlist.fm/search?artistName=${query}`, source: "setlist.fm", verified: false },
  ];
}

export const artistProfiles: ArtistProfile[] = allArtists.map((name) => {
  const slug = artistSlug(name);
  const entry = curated[slug] || {};
  const identityLinks: ArtistProfile["links"] = [
    ...(entry.identities?.spotify ? [{ label: "Spotify", url: `https://open.spotify.com/artist/${entry.identities.spotify}`, source: "spotify" as const, verified: true }] : []),
    ...(entry.identities?.musicbrainz ? [{ label: "MusicBrainz", url: `https://musicbrainz.org/artist/${entry.identities.musicbrainz}`, source: "musicbrainz" as const, verified: true }] : []),
  ];
  const links = [...(entry.links || []), ...identityLinks, ...searchLinks(name)];
  const identitySources = (["spotify", "musicbrainz", "setlist.fm"] as ArtistSource[])
    .filter((source) => links.some((link) => link.source === source && link.verified))
    .map((source) => ({ field: "identity", source, url: links.find((link) => link.source === source && link.verified)!.url, checkedAt }));
  const freshness = (cadenceDays: number): ArtistFreshness => ({
    checkedAt,
    cadenceDays,
    refreshAfter: new Date(Date.parse(`${checkedAt}T00:00:00Z`) + cadenceDays * 86_400_000).toISOString().slice(0, 10),
  });
  return {
    ...entry,
    name,
    slug,
    aliases: entry.aliases || [],
    genres: entry.genres || [],
    identities: entry.identities || {},
    links,
    topTracks: entry.topTracks || [],
    recentSetlists: entry.recentSetlists || [],
    provenance: [...(entry.provenance || []), ...identitySources],
    freshness: entry.freshness || { profile: freshness(90), music: freshness(14), setlists: freshness(7) },
  };
});

export function getArtistProfile(slug: string) {
  return artistProfiles.find((artist) => artist.slug === slug);
}
