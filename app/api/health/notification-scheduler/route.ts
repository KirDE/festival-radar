import { readFile } from "node:fs/promises";

const maximumAgeMs = 20 * 60 * 1000;

export async function GET() {
  const path = process.env.NOTIFICATION_SCHEDULER_STATE_FILE;
  if (!path) return Response.json({ status: "unconfigured" }, { status: 503 });
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as { finishedAt?: string; ok?: boolean; processed?: number; statuses?: Record<string, number> };
    const ageMs = state.finishedAt ? Date.now() - Date.parse(state.finishedAt) : Number.POSITIVE_INFINITY;
    const healthy = state.ok === true && Number.isFinite(ageMs) && ageMs <= maximumAgeMs;
    return Response.json({ status: healthy ? "ok" : "stale", ...state, ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null }, { status: healthy ? 200 : 503 });
  } catch {
    return Response.json({ status: "missing" }, { status: 503 });
  }
}
