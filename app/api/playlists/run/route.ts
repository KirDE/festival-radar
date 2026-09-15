import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { error } from "@/lib/api";

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
    return Response.json({ festivals: Object.keys(refreshed), status: refreshed });
  } catch (cause) {
    console.error("Production playlist refresh failed", cause instanceof Error ? cause.message : "unknown error");
    return error("Production playlist refresh failed.", 500);
  }
}
