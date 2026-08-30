import type { Festival } from "../../data/festivals.ts";
import type { IngestionResult } from "./types.ts";

export type PublicationStore = { schemaVersion: 1; festivals: Record<string, Partial<Pick<Festival, "city" | "ticketsUrl" | "status" | "headliners" | "lineup">>> };

export function applyPublication(store: PublicationStore, current: Festival, result: IngestionResult): PublicationStore {
  if (!result.publishable || result.reviewReasons.length) throw new Error(`Refusing review-required publication for ${result.festivalSlug}`);
  const next = structuredClone(store.festivals[result.festivalSlug] || {});
  for (const change of result.changes) {
    if (change.reviewRequired) throw new Error(`Refusing protected field ${change.field}`);
    if (change.field === "lineup" || change.field === "headliners") {
      const values = new Set([...(current[change.field] || []), ...((next[change.field] as string[] | undefined) || [])]);
      if (change.after) values.add(change.after);
      next[change.field] = [...values];
    } else if (["city", "ticketsUrl", "status"].includes(change.field)) Object.assign(next, { [change.field]: change.after });
    else throw new Error(`Unsupported automatic publication field ${change.field}`);
  }
  return { schemaVersion: 1, festivals: { ...store.festivals, [result.festivalSlug]: next } };
}

export function historyRecord(result: IngestionResult, outcome: string) {
  return { schemaVersion: 1, festivalSlug: result.festivalSlug, sourceUrl: result.sourceUrl, fetchedAt: result.fetchedAt, recordedAt: new Date().toISOString(), outcome, changes: result.changes.map(({ field, before, after, kind }) => ({ field, oldValue: before ?? null, newValue: after ?? null, kind })), reviewReasons: result.reviewReasons };
}
