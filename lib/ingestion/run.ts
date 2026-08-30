import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Festival } from "../../data/festivals.ts";
import type { FestivalSource } from "./types.ts";
import { extractFestivalCandidate } from "./extract.ts";
import { fetchSource, type FetchOptions } from "./fetch.ts";
import { evaluateCandidate } from "./policy.ts";

export type SourceHealth = { consecutiveFailures: number; lastAttemptAt: string; lastSuccessfulCheck?: string; lastFailure?: { at: string; error: string; httpStatus?: number } };
export type HealthState = { schemaVersion: 1; sources: Record<string, SourceHealth> };

export async function readHealthState(file: string): Promise<HealthState> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed?.schemaVersion === 1 && parsed.sources ? parsed : { schemaVersion: 1, sources: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, sources: {} };
    throw error;
  }
}

export async function runIngestion(input: { sources: FestivalSource[]; festivals: Festival[]; outputDirectory: string; stateFile: string; failureThreshold: number; now?: () => Date; fetchOptions?: FetchOptions }) {
  const now = input.now ?? (() => new Date());
  const state = await readHealthState(input.stateFile);
  const summary = { schemaVersion: 2, generatedAt: now().toISOString(), status: "healthy" as "healthy" | "degraded" | "failed", processed: 0, changed: 0, publishable: 0, reviewRequired: 0, fetchErrors: 0, escalatedFailures: 0, results: [] as Record<string, unknown>[] };
  await mkdir(input.outputDirectory, { recursive: true });

  for (const source of input.sources) {
    const current = input.festivals.find(({ slug }) => slug === source.festivalSlug);
    if (!current) throw new Error(`No current festival for ${source.festivalSlug}`);
    const fetchedAt = now().toISOString();
    try {
      const { response, attempts } = await fetchSource(source, input.fetchOptions);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { httpStatus: response.status, attempts });
      const candidate = extractFestivalCandidate(await response.text(), source, fetchedAt);
      const result = evaluateCandidate(current, candidate);
      const status = result.reviewReasons.length ? "review" : result.publishable ? "publishable" : "unchanged";
      await writeFile(path.join(input.outputDirectory, `${source.festivalSlug}.json`), `${JSON.stringify({ status, source: { ...source, httpStatus: response.status, finalUrl: response.url, attempts }, result }, null, 2)}\n`);
      state.sources[source.festivalSlug] = { consecutiveFailures: 0, lastAttemptAt: fetchedAt, lastSuccessfulCheck: fetchedAt };
      summary.processed += 1;
      if (result.changes.length) summary.changed += 1;
      if (result.publishable) summary.publishable += 1;
      if (result.reviewReasons.length) summary.reviewRequired += 1;
      summary.results.push({ festivalSlug: source.festivalSlug, status, attempts, changes: result.changes.length, reviewReasons: result.reviewReasons });
    } catch (error) {
      const previous = state.sources[source.festivalSlug];
      const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
      const message = error instanceof Error ? error.message : String(error);
      const httpStatus = Number((error as { httpStatus?: number }).httpStatus) || undefined;
      const attempts = Number((error as { attempts?: number }).attempts) || 1;
      state.sources[source.festivalSlug] = { consecutiveFailures, lastAttemptAt: fetchedAt, lastSuccessfulCheck: previous?.lastSuccessfulCheck, lastFailure: { at: fetchedAt, error: message, httpStatus } };
      summary.fetchErrors += 1;
      if (consecutiveFailures >= input.failureThreshold) summary.escalatedFailures += 1;
      summary.results.push({ festivalSlug: source.festivalSlug, status: consecutiveFailures >= input.failureThreshold ? "escalated_failure" : "fetch_error", error: message, httpStatus, attempts, consecutiveFailures, lastSuccessfulCheck: previous?.lastSuccessfulCheck ?? null });
    }
  }
  summary.status = summary.escalatedFailures ? "failed" : summary.fetchErrors ? "degraded" : "healthy";
  await mkdir(path.dirname(input.stateFile), { recursive: true });
  await writeFile(input.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(path.join(input.outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
