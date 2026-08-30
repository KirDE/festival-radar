import { Prisma, SyncKind } from "@prisma/client";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { spotifyAccessToken, spotifyEndpoints } from "@/lib/spotify";

type SpotifyPlaylist = { id: string; name: string; external_urls: { spotify: string }; images: Array<{ url: string }>; owner: { id: string; display_name: string | null }; tracks: { total: number } };

export async function POST() {
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const connection = await db.spotifyConnection.findUnique({ where: { userId: user.id } });
  if (!connection) return error("Connect Spotify first.", 409);
  try {
    const token = await spotifyAccessToken(connection.encryptedRefreshToken);
    const playlists: SpotifyPlaylist[] = [];
    let next: string | null = `${spotifyEndpoints().api}/v1/me/playlists?limit=50`;
    while (next && playlists.length < 500) {
      const response: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Spotify playlist lookup failed");
      const page = await response.json() as { items: SpotifyPlaylist[]; next: string | null };
      playlists.push(...page.items); next = page.next;
    }
    const payload = { source: "spotify", syncedAt: new Date().toISOString(), playlists: playlists.map((item) => ({ id: item.id, name: item.name, url: item.external_urls.spotify, image: item.images[0]?.url ?? null, owner: item.owner.display_name ?? item.owner.id, trackCount: item.tracks.total })) } as Prisma.InputJsonValue;
    const document = await db.syncDocument.upsert({ where: { userId_kind: { userId: user.id, kind: SyncKind.COLLECTIONS } }, create: { userId: user.id, kind: SyncKind.COLLECTIONS, payload }, update: { payload, revision: { increment: 1 } } });
    await db.spotifyConnection.update({ where: { userId: user.id }, data: { lastSyncedAt: new Date() } });
    return Response.json({ document });
  } catch { return error("Spotify synchronization failed.", 502); }
}
