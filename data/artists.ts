import { allArtists, artistSlug } from "./festivals.ts";

export type ArtistSource = "official" | "spotify" | "musicbrainz" | "setlist.fm";

export type ArtistProfile = {
  name: string;
  slug: string;
  aliases: string[];
  origin?: string;
  genres: string[];
  biography?: string;
  imageUrl?: string;
  identities: { spotify?: string; musicbrainz?: string; setlistFm?: string };
  links: { label: string; url: string; source: ArtistSource }[];
  topTracks: string[];
  recentSetlists: { date: string; venue: string; url: string }[];
  provenance: { field: string; source: ArtistSource; url: string; checkedAt: string }[];
};

const checkedAt = "2026-08-28";

const curated: Record<string, Partial<ArtistProfile>> = {
  "electric-callboy": {
    aliases: ["Eskimo Callboy"],
    origin: "Castrop-Rauxel, Germany",
    genres: ["electronicore", "metalcore"],
    biography: "German electronicore band known for combining metalcore with electronic and dance music.",
    identities: {
      spotify: "5pz7f2hG2q2TuFovkw4Z0n",
      musicbrainz: "8e5d91df-ec18-4c9b-8d56-4f4039f03ae8",
      setlistFm: "8e5d91df-ec18-4c9b-8d56-4f4039f03ae8",
    },
    topTracks: ["Hypa Hypa", "We Got the Moves", "Pump It"],
    links: [{ label: "Official site", url: "https://www.electriccallboy.com/", source: "official" }],
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
    links: [{ label: "Official site", url: "https://www.halestormrocks.com/", source: "official" }],
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
    links: [{ label: "Official site", url: "https://www.helloween.org/", source: "official" }],
  },
};

function searchLinks(name: string): ArtistProfile["links"] {
  const query = encodeURIComponent(name);
  return [
    { label: "Spotify", url: `https://open.spotify.com/search/${query}`, source: "spotify" },
    { label: "MusicBrainz", url: `https://musicbrainz.org/search?query=${query}&type=artist`, source: "musicbrainz" },
    { label: "setlist.fm", url: `https://www.setlist.fm/search?artistName=${query}`, source: "setlist.fm" },
  ];
}

export const artistProfiles: ArtistProfile[] = allArtists.map((name) => {
  const slug = artistSlug(name);
  const entry = curated[slug] || {};
  const links = [...(entry.links || []), ...searchLinks(name)];
  const identitySources = (["spotify", "musicbrainz", "setlist.fm"] as ArtistSource[])
    .filter((source) => links.some((link) => link.source === source))
    .map((source) => ({ field: "identity", source, url: links.find((link) => link.source === source)!.url, checkedAt }));
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
  };
});

export function getArtistProfile(slug: string) {
  return artistProfiles.find((artist) => artist.slug === slug);
}
