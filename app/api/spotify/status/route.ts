import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";

export async function GET() {
  const user = await requireUser();
  if (!user) return error("Authentication required.", 401);
  const connection = await db.spotifyConnection.findUnique({ where: { userId: user.id }, select: { spotifyUserId: true, lastSyncedAt: true, updatedAt: true } });
  return Response.json({ connected: Boolean(connection), connection });
}
