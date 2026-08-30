import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FestivalSource } from "./types.ts";

export interface FreshnessState {
  schemaVersion: 1;
  updatedAt: string;
  sources: Record<string, { lastSuccessfulCheck: string }>;
}

export function emptyFreshnessState(now = new Date()): FreshnessState {
  return { schemaVersion: 1, updatedAt: now.toISOString(), sources: {} };
}

export async function readFreshnessState(filePath: string): Promise<FreshnessState> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFreshnessState();
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<FreshnessState>;
  if (parsed.schemaVersion !== 1 || !parsed.sources || typeof parsed.sources !== "object") {
    throw new Error(`Unsupported freshness state in ${filePath}`);
  }

  const sources: FreshnessState["sources"] = {};
  for (const [slug, value] of Object.entries(parsed.sources)) {
    const checkedAt = value?.lastSuccessfulCheck;
    if (typeof checkedAt !== "string" || !Number.isFinite(Date.parse(checkedAt))) {
      throw new Error(`Invalid lastSuccessfulCheck for ${slug} in ${filePath}`);
    }
    sources[slug] = { lastSuccessfulCheck: checkedAt };
  }
  return { schemaVersion: 1, updatedAt: parsed.updatedAt || new Date(0).toISOString(), sources };
}

export function applyFreshnessState(sources: FestivalSource[], state: FreshnessState): FestivalSource[] {
  return sources.map((source) => ({
    ...source,
    lastSuccessfulCheck: state.sources[source.festivalSlug]?.lastSuccessfulCheck,
  }));
}

export function recordCheckResult(state: FreshnessState, festivalSlug: string, checkedAt: string, successful: boolean): FreshnessState {
  if (!successful) return state;
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error(`Invalid successful-check timestamp: ${checkedAt}`);
  return {
    schemaVersion: 1,
    updatedAt: checkedAt,
    sources: { ...state.sources, [festivalSlug]: { lastSuccessfulCheck: checkedAt } },
  };
}

export async function writeFreshnessState(filePath: string, state: FreshnessState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}
