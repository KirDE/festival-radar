// LINKED alone does not identify the reviewed provider. Require an explicit,
// verified Spotify artist link agreeing with the canonical identity as well.
export function verifiedSpotifyArtistId(artist: {
  identityState: string;
  identities: { provider: string; externalId: string }[];
  links: { source: string; url: string; verified: boolean }[];
}) {
  if (artist.identityState !== "LINKED") return null;
  const identities = artist.identities.filter((item) => item.provider === "spotify");
  if (identities.length !== 1 || !/^[A-Za-z0-9]{22}$/.test(identities[0].externalId)) return null;
  const links = artist.links.filter((link) => link.verified && link.source === "spotify");
  if (links.length === 0) return null;
  return links.every((link) => /^https:\/\/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})\/?$/.exec(link.url)?.[1] === identities[0].externalId)
    ? identities[0].externalId : null;
}
