import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { error } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2_700;

const execute = promisify(execFile);
const input = z.object({
  festivals: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
});

export async function POST(request: Request) {
  if (!process.env.INTERNAL_API_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INTERNAL_API_SECRET}`) return error("Unauthorized.", 401);
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid playlist refresh request.");

  const festivals = [...new Set(parsed.data.festivals ?? [])].sort();
  const staleBefore = new Date(Date.now() - 3 * 60 * 60 * 1_000);
  const claimable: Prisma.CatalogPlaylistRefreshWhereInput = { OR: [{ status: { in: ["PENDING", "FAILED"] } }, { status: "RUNNING", startedAt: { lt: staleBefore } }] };
  const queued = await db.catalogPlaylistRefresh.findMany({
    where: { ...claimable, ...(festivals.length ? { festivalSlug: { in: festivals } } : {}) },
    select: { id: true },
  });
  const candidateQueueIds = queued.map(({ id }) => id);
  const claimStartedAt = new Date();
  if (candidateQueueIds.length) await db.catalogPlaylistRefresh.updateMany({
    where: { id: { in: candidateQueueIds }, ...claimable },
    data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: claimStartedAt, completedAt: null, lastError: null },
  });
  const claimed = candidateQueueIds.length ? await db.catalogPlaylistRefresh.findMany({ where: { id: { in: candidateQueueIds }, status: "RUNNING", startedAt: claimStartedAt }, select: { id: true } }) : [];
  const queueIds = claimed.map(({ id }) => id);
  try {
    await execute("bash", ["scripts/deploy/run-collection-job.sh", "playlists", festivals.join(",")], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 2_650_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const status = JSON.parse(await readFile(path.join(process.cwd(), "data/playlist-status.json"), "utf8"));
    const refreshed = Object.fromEntries(
      (festivals.length ? festivals : Object.keys(status)).map((slug) => [slug, status[slug] ?? null]),
    );
    if (Object.values(refreshed).some((value) => !value)) throw new Error("Playlist status read-back is incomplete");
    await db.$transaction(async (tx) => {
      for (const [slug, value] of Object.entries(refreshed)) {
        if (!value || typeof value !== "object" || !("spotifyUrl" in value) || typeof value.spotifyUrl !== "string") throw new Error(`Invalid playlist status for ${slug}`);
        const editions = await tx.festivalEdition.findMany({ where: { festival: { slug }, recordState: "CURRENT" }, select: { id: true } });
        if (editions.length !== 1) throw new Error(`Ambiguous current edition for ${slug}`);
        const syncedAt = "updatedAt" in value && typeof value.updatedAt === "string" ? new Date(value.updatedAt) : new Date();
        const artistCount = "artists" in value && typeof value.artists === "number" ? value.artists : null;
        const trackCount = "tracks" in value && typeof value.tracks === "number" ? value.tracks : null;
        await tx.festivalPlaylist.upsert({
          where: { editionId_provider: { editionId: editions[0].id, provider: "spotify" } },
          create: { editionId: editions[0].id, provider: "spotify", url: value.spotifyUrl, artistCount, trackCount, syncedAt },
          update: { url: value.spotifyUrl, artistCount, trackCount, syncedAt },
        });
        if ("youtubeMusicUrl" in value && typeof value.youtubeMusicUrl === "string") await tx.festivalPlaylist.upsert({
          where: { editionId_provider: { editionId: editions[0].id, provider: "youtube_music" } },
          create: { editionId: editions[0].id, provider: "youtube_music", url: value.youtubeMusicUrl, artistCount, trackCount, syncedAt },
          update: { url: value.youtubeMusicUrl, artistCount, trackCount, syncedAt },
        });
      }
      if (queueIds.length) await tx.catalogPlaylistRefresh.updateMany({ where: { id: { in: queueIds }, status: "RUNNING" }, data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null } });
    }, { isolationLevel: "Serializable", timeout: 30_000 });
    return Response.json({ festivals: Object.keys(refreshed), status: refreshed, catalogRefreshRequests: queueIds });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    if (queueIds.length) await db.catalogPlaylistRefresh.updateMany({ where: { id: { in: queueIds }, status: "RUNNING" }, data: { status: "FAILED", completedAt: new Date(), lastError: message.slice(0, 1_000) } });
    console.error("Production playlist refresh failed", message);
    return error("Production playlist refresh failed.", 500);
  }
}
