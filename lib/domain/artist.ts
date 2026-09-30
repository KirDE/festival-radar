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
  identityState: "linked" | "ambiguous" | "unresolved" | "retryable";
  links: { label: string; url: string; source: ArtistSource; verified: boolean }[];
  topTracks: string[];
  recentSetlists: { date: string; venue: string; url: string }[];
  provenance: { field: string; source: ArtistSource; url: string; checkedAt: string }[];
  freshness: { profile: ArtistFreshness; music: ArtistFreshness; setlists: ArtistFreshness };
};
