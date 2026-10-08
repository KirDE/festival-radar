import type { PrismaClient } from "@prisma/client";
import { verifiedSpotifyArtistId } from "../artist-spotify-identity.ts";

export function parseSpotifyArtistStats(raw: unknown, id: string) {
  const value = raw as { id?: string; type?: string; popularity?: unknown; followers?: { total?: unknown } } | null;
  if (!value || value.id !== id || value.type !== "artist") throw new Error("spotify_artist_identity_mismatch");
  const integer = (n: unknown, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
  return { popularity: integer(value.popularity, 100), followers: integer(value.followers?.total, Number.MAX_SAFE_INTEGER) };
}

// Lazy client-credentials token; never search for or bind an artist by name.
// Failures (including forbidden/unavailable endpoints) leave the last snapshot.
export function spotifyArtistFetcher(fetcher: typeof fetch = fetch,
  configuration = () => ({ clientId: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET })) {
  let token: string | undefined;
  let expiresAt = 0;
  let unavailable = false;
  const fetchArtist = async (id: string) => {
    if (!token || Date.now() >= expiresAt) {
      const { clientId, secret } = configuration();
      if (!clientId || !secret) throw new Error("spotify_stats_unavailable");
      const response = await fetcher("https://accounts.spotify.com/api/token", {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials", signal: AbortSignal.timeout(30_000), cache: "no-store",
      });
      if (!response.ok) throw new Error("spotify_stats_unavailable");
      const payload = await response.json() as { access_token?: string; expires_in?: number };
      if (!payload.access_token) throw new Error("spotify_stats_unavailable");
      token = payload.access_token;
      expiresAt = Date.now() + Math.max(0, (payload.expires_in ?? 3600) - 60) * 1000;
    }
    const response = await fetcher(`https://api.spotify.com/v1/artists/${id}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000), cache: "no-store",
    });
    if (!response.ok) { if (response.status === 401) token = undefined; throw new Error("spotify_stats_unavailable"); }
    return response.json();
  };
  return async (id: string) => {
    if (unavailable) throw new Error("spotify_stats_unavailable");
    try { return await fetchArtist(id); }
    catch { unavailable = true; throw new Error("spotify_stats_unavailable"); }
  };
}

export async function refreshSpotifyArtistStats({ db, lease, slug, fetchArtist, now = () => new Date() }: {
  db: PrismaClient; lease: { key: string; owner: string }; slug: string;
  fetchArtist: (id: string) => Promise<unknown>; now?: () => Date;
}) {
  if (lease.key !== "artist-enrichment") throw new Error("Invalid enrichment lease key");
  const artist = await db.artist.findUnique({ where: { slug }, include: { identities: true, links: true } });
  const id = artist && verifiedSpotifyArtistId(artist);
  if (!artist || !id) return "unverified";
  const checkedAt = now();
  let stats;
  try { stats = parseSpotifyArtistStats(await fetchArtist(id), id); }
  catch { return "unavailable"; }
  return db.$transaction(async (tx) => {
    const held = await tx.$queryRaw<{ key: string }[]>`SELECT key FROM "OperationalState"
      WHERE key = ${lease.key} AND "leaseOwner" = ${lease.owner}
      AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (held.length !== 1) throw new Error("Operational state lease lost");
    const current = await tx.artist.findUnique({ where: { slug }, include: { identities: true, links: true } });
    if (!current || current.id !== artist.id || verifiedSpotifyArtistId(current) !== id) return "unverified";
    const owner = await tx.artistIdentity.findUnique({ where: { provider_externalId: { provider: "spotify", externalId: id } } });
    if (!owner || owner.artistId !== current.id) return "unverified";
    if (current.spotifyStatsCheckedAt && current.spotifyStatsCheckedAt >= checkedAt) return "older";
    await tx.artist.update({ where: { id: current.id }, data: {
      spotifyPopularity: stats.popularity, spotifyFollowers: stats.followers === null ? null : BigInt(stats.followers),
      spotifyStatsCheckedAt: checkedAt, spotifyStatsArtistId: id,
      spotifyStatsSourceUrl: `https://api.spotify.com/v1/artists/${id}`,
    } });
    const valid = await tx.$queryRaw<{ key: string }[]>`SELECT key FROM "OperationalState"
      WHERE key = ${lease.key} AND "leaseOwner" = ${lease.owner}
      AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
    if (valid.length !== 1) throw new Error("Operational state lease lost");
    return "updated";
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
