import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { festivals } from "../data/festivals.ts";
import { festivalSources } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { dueFestivalSources } from "../lib/ingestion/schedule.ts";
import { notificationEventsForChanges } from "../lib/ingestion/notification-events.ts";
import { db } from "../lib/db.ts";
import { createIngestionRun, finishIngestionRun, ingestionQueries, persistAttempt } from "../lib/ingestion/repository.ts";
import { applyPublication, historyRecord } from "../lib/ingestion/publication.ts";

const args = new Set(process.argv.slice(2));
const slugArg = process.argv.find((value) => value.startsWith("--slug="))?.slice(7);
const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
const outputDirectory = path.resolve(outputArg || "outputs/ingestion");
const publicationsPath = path.resolve(process.argv.find((value) => value.startsWith("--publications="))?.slice(15) || "data/ingestion-publications.json");
const historyPath = path.resolve(process.argv.find((value) => value.startsWith("--history="))?.slice(10) || "data/ingestion-history.jsonl");
const fixturePath = process.argv.find((value) => value.startsWith("--fixture="))?.slice(10);
const publish = args.has("--publish");
const force = args.has("--force");
const maxFetchErrorsArg = process.argv.find((value) => value.startsWith("--max-fetch-errors="))?.slice(19) ?? process.env.INGESTION_MAX_FETCH_ERRORS;
const failureThresholdArg = process.argv.find((value) => value.startsWith("--failure-threshold="))?.slice(20) ?? process.env.INGESTION_FAILURE_THRESHOLD ?? "3";
const failureThreshold = Number(failureThresholdArg);
if (!Number.isInteger(failureThreshold) || failureThreshold < 1) throw new Error(`Invalid consecutive failure threshold: ${failureThresholdArg}`);
const persistenceEnabled = Boolean(process.env.DATABASE_URL);
const dueOnly = args.has("--due") && !force;
const persistedStates = dueOnly && persistenceEnabled ? await ingestionQueries.sourceStates(db) : [];
const lastSuccessfulChecks = new Map(persistedStates.map((state) => [state.festivalSlug, state.lastSuccessfulCheck?.toISOString()]));
const hydratedSources = festivalSources.map((source) => ({ ...source, lastSuccessfulCheck: lastSuccessfulChecks.get(source.festivalSlug) ?? source.lastSuccessfulCheck }));
const eligible = dueOnly ? dueFestivalSources(hydratedSources) : hydratedSources.filter((source) => source.enabled);
const selected = eligible.filter((source) => !slugArg || source.festivalSlug === slugArg);
const notificationEndpoint = process.env.NOTIFICATION_EVENTS_URL || (process.env.APP_URL ? new URL("/api/notifications/events/", process.env.APP_URL).toString() : undefined);
const notificationDeliveryEnabled = Boolean(notificationEndpoint || process.env.INTERNAL_API_SECRET || process.env.NOTIFICATION_DELIVERY_REQUIRED === "true");
if (publish && notificationDeliveryEnabled && (!notificationEndpoint || !process.env.INTERNAL_API_SECRET)) throw new Error("Published ingestion requires APP_URL (or NOTIFICATION_EVENTS_URL) and INTERNAL_API_SECRET");
if (selected.length === 0) throw new Error(slugArg ? `Unknown or disabled festival source: ${slugArg}` : "No enabled festival sources");
const maxFetchErrors = maxFetchErrorsArg === undefined ? Math.max(0, selected.length - 1) : Number(maxFetchErrorsArg);
if (!Number.isInteger(maxFetchErrors) || maxFetchErrors < 0) throw new Error(`Invalid maximum fetch error count: ${maxFetchErrorsArg}`);

await mkdir(outputDirectory, { recursive: true });
const trigger = process.env.GITHUB_EVENT_NAME === "schedule" ? "SCHEDULE" : "MANUAL";
const run = persistenceEnabled ? await createIngestionRun(db, { trigger, sourceCommit: process.env.GITHUB_SHA || "local", totalSources: selected.length }) : null;
const summary = { schemaVersion: 1, ingestionRunId: run?.id ?? null, generatedAt: new Date().toISOString(), dryRun: !publish, totalSources: selected.length, attempted: 0, processed: 0, changed: 0, publishable: 0, published: 0, reviewRequired: 0, fetchErrors: 0, escalatedFailures: 0, notificationEvents: 0, maxFetchErrors, failureThreshold, status: "RUNNING", results: [] };
let publicationStore = JSON.parse(await readFile(publicationsPath, "utf8"));
const history = [];

for (const source of selected) {
  summary.attempted += 1;
  const current = festivals.find(({ slug }) => slug === source.festivalSlug);
  if (!current) throw new Error(`No current festival for ${source.festivalSlug}`);
  const fetchedAt = new Date().toISOString();
  const startedAt = new Date();
  let response;
  let html;
  try {
    if (!fixturePath) {
      const fetched = await fetchSource(source);
      response = fetched.response;
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { httpStatus: response.status, attempts: fetched.attempts });
    }
    html = fixturePath ? await readFile(path.resolve(fixturePath), "utf8") : await response.text();
  } catch (error) {
    const attempts = Number(error?.attempts) || 1;
    if (run) await persistAttempt(db, { runId: run.id, festivalSlug: source.festivalSlug, requestedUrl: source.url, httpStatus: Number(error?.httpStatus) || undefined, durationMs: Date.now() - startedAt.getTime(), retryCount: attempts - 1, startedAt, endedAt: new Date(), error: error instanceof Error ? error.message : String(error) });
    const consecutiveFailures = persistenceEnabled ? await ingestionQueries.consecutiveFailures(db, source.festivalSlug) : 1;
    const escalated = consecutiveFailures >= failureThreshold;
    summary.fetchErrors += 1;
    if (escalated) summary.escalatedFailures += 1;
    const lastExtraction = persistenceEnabled ? await ingestionQueries.lastSuccessfulExtraction(db, source.festivalSlug) : null;
    summary.results.push({ festivalSlug: source.festivalSlug, status: escalated ? "escalated_failure" : "fetch_error", extractionPath: source.strategies, manualReviewReason: source.manualReviewReason ?? null, evidenceFields: [], lastSuccessfulExtraction: lastExtraction?.observedAt.toISOString() ?? null, error: error instanceof Error ? error.message : String(error), attempts, consecutiveFailures });
    continue;
  }

  const candidate = extractFestivalCandidate(html, source, fetchedAt);
  const result = evaluateCandidate(current, candidate);
  const status = result.reviewReasons.length ? "review" : result.publishable ? "publishable" : "unchanged";
  const artifact = { status, source: { ...source, httpStatus: response?.status ?? null, finalUrl: response?.url ?? source.url }, result };
  if (run) await persistAttempt(db, { runId: run.id, festivalSlug: source.festivalSlug, requestedUrl: source.url, finalUrl: response?.url ?? source.url, httpStatus: response?.status ?? null, durationMs: Date.now() - startedAt.getTime(), startedAt, endedAt: new Date(), result });
  await writeFile(path.join(outputDirectory, `${source.festivalSlug}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  summary.processed += 1;
  if (result.changes.length) summary.changed += 1;
  if (result.publishable) summary.publishable += 1;
  if (result.reviewReasons.length) summary.reviewRequired += 1;
  let outcome = result.changes.length ? (result.reviewReasons.length ? "review_required" : "dry_run") : "unchanged";
  if (publish && result.publishable && !result.reviewReasons.length) {
    const nextStore = applyPublication(publicationStore, current, result);
    if (JSON.stringify(nextStore) !== JSON.stringify(publicationStore)) {
      publicationStore = nextStore;
      summary.published += 1;
      outcome = "published";
      if (notificationDeliveryEnabled) {
        const events = notificationEventsForChanges(current, result.changes, fetchedAt);
        for (const event of events) {
          const notificationResponse = await fetch(notificationEndpoint, { method: "POST", headers: { authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`, "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(20_000) });
          if (!notificationResponse.ok) throw new Error(`Notification event persistence failed with HTTP ${notificationResponse.status}`);
          summary.notificationEvents += 1;
        }
      }
    }
    else outcome = "unchanged";
  }
  history.push(historyRecord(result, outcome));
  const lastExtraction = persistenceEnabled ? await ingestionQueries.lastSuccessfulExtraction(db, source.festivalSlug) : null;
  summary.results.push({ festivalSlug: source.festivalSlug, status, outcome, extractionPath: source.strategies, manualReviewReason: source.manualReviewReason ?? null, evidenceFields: candidate.evidence.map(({ field }) => field), lastSuccessfulExtraction: lastExtraction?.observedAt.toISOString() ?? (candidate.evidence.length ? fetchedAt : null), changes: result.changes.length, reviewReasons: result.reviewReasons });
}

if (run) await finishIngestionRun(db, run.id);
summary.status = summary.fetchErrors === 0 ? "COMPLETED" : summary.fetchErrors <= maxFetchErrors && summary.escalatedFailures === 0 ? "PARTIAL" : "FAILED";
if (publish) await writeFile(publicationsPath, `${JSON.stringify(publicationStore, null, 2)}\n`);
if (history.length) await appendFile(historyPath, `${history.map((record) => JSON.stringify(record)).join("\n")}\n`);
await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
if (summary.status === "FAILED") process.exitCode = 2;
if (persistenceEnabled) await db.$disconnect();
