import { readFile } from "node:fs/promises";
import { notificationDeliveryReady, notificationProviderState } from "@/lib/notification-providers";

const maximumAgeMs = 20 * 60 * 1000;

export async function GET() {
  const providers = notificationProviderState();
  const deliveryReady = notificationDeliveryReady(providers);
  const path = process.env.NOTIFICATION_SCHEDULER_STATE_FILE;
  if (!path) return Response.json({ status: "unconfigured", schedulerStatus: "unconfigured", deliveryReady, providers }, { status: 503 });
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as { finishedAt?: string; ok?: boolean; processed?: number; statuses?: Record<string, number>; lastDeliveryAt?: string; lastDeliveryStatuses?: Record<string, number> };
    const ageMs = state.finishedAt ? Date.now() - Date.parse(state.finishedAt) : Number.POSITIVE_INFINITY;
    const schedulerHealthy = state.ok === true && Number.isFinite(ageMs) && ageMs <= maximumAgeMs;
    const healthy = schedulerHealthy && deliveryReady;
    return Response.json({ status: healthy ? "ok" : schedulerHealthy ? "degraded" : "stale", schedulerStatus: schedulerHealthy ? "ok" : "stale", deliveryReady, providers, ...state, ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null }, { status: healthy ? 200 : 503 });
  } catch {
    return Response.json({ status: "missing", schedulerStatus: "missing", deliveryReady, providers }, { status: 503 });
  }
}
