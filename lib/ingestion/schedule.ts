import type { FestivalSource, RefreshPolicy } from "./types.ts";

const intervals: Record<RefreshPolicy, number> = {
  daily: 24 * 60 * 60 * 1_000,
  every_3_days: 3 * 24 * 60 * 60 * 1_000,
  weekly: 7 * 24 * 60 * 60 * 1_000,
  archived: 30 * 24 * 60 * 60 * 1_000,
};

export function isSourceDue(source: FestivalSource, now = new Date()): boolean {
  if (!source.enabled) return false;
  if (!source.lastSuccessfulCheck) return true;
  const checkedAt = Date.parse(source.lastSuccessfulCheck);
  return !Number.isFinite(checkedAt) || now.getTime() - checkedAt >= intervals[source.refreshPolicy];
}

export function dueFestivalSources(sources: FestivalSource[], now = new Date()): FestivalSource[] {
  return sources.filter((source) => isSourceDue(source, now));
}
