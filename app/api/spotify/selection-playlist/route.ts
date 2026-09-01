import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { spotifyAccessToken } from "@/lib/spotify";
import { createSelectionPlaylist } from "@/lib/selection-playlist";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

const payload = z.object({
  artists: z.array(z.string().trim().min(1).max(200)).min(1).max(250),
  festivals: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
});

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const user = await requireUser();
  if (!user) return error("Sign in before creating a playlist.", 401);
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Select at least one valid festival lineup.", 400);
  const connection = await db.spotifyConnection.findUnique({ where: { userId: user.id } });
  if (!connection) return error("Connect Spotify before creating a playlist.", 409);
  try {
    const token = await spotifyAccessToken(connection.encryptedRefreshToken);
    return Response.json(await createSelectionPlaylist({ token, spotifyUserId: connection.spotifyUserId, ...parsed.data }));
  } catch (cause) {
    console.error("selection_playlist_failed", { userId: user.id, message: cause instanceof Error ? cause.message : "unknown" });
    return error("Spotify could not create the playlist. Your selection is still saved; retry or export the fallback list.", 502);
  }
}
