import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { festivals } from "../data/festivals.ts";
import { listConfiguredSources } from "../lib/sources/repository.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { dueFestivalSources } from "../lib/ingestion/schedule.ts";
import { notificationEventsForChanges, uniqueNotificationEvents } from "../lib/ingestion/notification-events.ts";
import { db } from "../lib/db.ts";
import { publishIngestionResult } from "../lib/catalog/publication.ts";
import { readCatalog } from "../lib/catalog/repository.ts";
import { claimDueSources, completeSourceLease, startSourceLeaseRenewal } from "../lib/ingestion/lease.ts";
import { randomUUID } from "node:crypto";
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
// Explicit opt-in only: the scheduler and manual --due path remain unchanged.
const dbDue = args.has("--db-due");
if (dbDue && (!process.env.DATABASE_URL || !publish || force || slugArg || args.has("--due"))) throw new Error("--db-due requires database and --publish, without --force, --due or --slug");
const maxFetchErrorsArg = process.argv.find((value) => value.startsWith("--max-fetch-errors="))?.slice(19) ?? process.env.INGESTION_MAX_FETCH_ERRORS;
const failureThresholdArg = process.argv.find((value) => value.startsWith("--failure-threshold="))?.slice(20) ?? process.env.INGESTION_FAILURE_THRESHOLD ?? "3";
const failureThreshold = Number(failureThresholdArg);
if (!Number.isInteger(failureThreshold) || failureThreshold < 1) throw new Error(`Invalid consecutive failure threshold: ${failureThresholdArg}`);
const persistenceEnabled = Boolean(process.env.DATABASE_URL);
// The file catalogue is available only to explicit local fixtures. A live DB
// failure must never select stale repository sources or publish from them.
if (!persistenceEnabled && !fixturePath) throw new Error("Database-backed sources are required outside explicit local fixtures");
const runtimeFestivals = persistenceEnabled ? (await readCatalog({ database: db })).festivals : festivals;
const configuredSources = dbDue ? [] : persistenceEnabled ? await listConfiguredSources(db) : (await import("../data/festival-sources.ts")).festivalSources;
if (persistenceEnabled && !dbDue && configuredSources.length === 0) throw new Error("No configured database sources");
const dueOnly = args.has("--due") && !force;
const persistedStates = dueOnly && persistenceEnabled ? await ingestionQueries.sourceStates(db) : [];
const lastSuccessfulChecks = new Map(persistedStates.map((state) => [state.festivalSlug, state.lastSuccessfulCheck?.toISOString()]));
const hydratedSources = configuredSources.map((source) => ({ ...source, lastSuccessfulCheck: lastSuccessfulChecks.get(source.festivalSlug) ?? source.lastSuccessfulCheck }));
const eligible = dueOnly ? dueFestivalSources(hydratedSources) : hydratedSources.filter((source) => source.enabled);
let selected = eligible.filter((source) => !slugArg || source.festivalSlug === slugArg);
const notificationEndpoint = !dbDue && (process.env.NOTIFICATION_EVENTS_URL || (process.env.APP_URL ? new URL("/api/notifications/events/", process.env.APP_URL).toString() : undefined));
const notificationDeliveryEnabled = Boolean(notificationEndpoint || process.env.INTERNAL_API_SECRET || process.env.NOTIFICATION_DELIVERY_REQUIRED === "true");
if (publish && !dbDue && notificationDeliveryEnabled && (!notificationEndpoint || !process.env.INTERNAL_API_SECRET)) throw new Error("Published ingestion requires APP_URL (or NOTIFICATION_EVENTS_URL) and INTERNAL_API_SECRET");
// Reject malformed controls before acquiring a lease; no invalid invocation
// should strand a claimed source until its TTL expires.
if (dbDue && maxFetchErrorsArg !== undefined && (!Number.isInteger(Number(maxFetchErrorsArg)) || Number(maxFetchErrorsArg) < 0)) throw new Error("Invalid maximum fetch error count");
if (dbDue) await mkdir(outputDirectory, { recursive: true });
let sourceLease = null;
let leaseRenewal = null;
let run = null;
if (dbDue) {
  const owner = randomUUID();
  const claims = await claimDueSources(db, { owner, now: new Date(), limit: 1, ttlMs: 30 * 60_000 });
  if (claims.length === 0) {
    console.log(JSON.stringify({ status: "NO_DUE_SOURCES", attempted: 0 }));
    await db.$disconnect();
    process.exit(0);
  }
  sourceLease = { ...claims[0], owner };
  try {
    leaseRenewal = startSourceLeaseRenewal(db, sourceLease);
    // Resolve after claim to avoid parsing a stale pre-claim configuration.
    const row = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceLease.id } });
    if (row.updatedAt.getTime() !== sourceLease.updatedAt.getTime()) throw new Error("Claimed source was edited after claim");
    selected = (await listConfiguredSources(db, row.festivalSlug)).filter((source) => source.id === row.id);
    if (selected.length !== 1) throw new Error("Claimed source is not configured");
    run = await createIngestionRun(db, { trigger: process.env.GITHUB_EVENT_NAME === "schedule" ? "SCHEDULE" : "MANUAL", sourceCommit: process.env.GITHUB_SHA || "local", totalSources: selected.length });
  } catch (error) {
    try { await leaseRenewal?.stop(); } catch { /* retain the original setup error */ }
    await completeSourceLease(db, { ...sourceLease, now: new Date(), outcome: "pre_attempt_error" });
    throw error;
  }
}
if (selected.length === 0) throw new Error(slugArg ? `Unknown or disabled festival source: ${slugArg}` : "No enabled festival sources");
const maxFetchErrors = maxFetchErrorsArg === undefined ? Math.max(0, selected.length - 1) : Number(maxFetchErrorsArg);
if (!Number.isInteger(maxFetchErrors) || maxFetchErrors < 0) throw new Error(`Invalid maximum fetch error count: ${maxFetchErrorsArg}`);

if (!dbDue) await mkdir(outputDirectory, { recursive: true });
const trigger = process.env.GITHUB_EVENT_NAME === "schedule" ? "SCHEDULE" : "MANUAL";
if (!dbDue && persistenceEnabled) run = await createIngestionRun(db, { trigger, sourceCommit: process.env.GITHUB_SHA || "local", totalSources: selected.length });
const summary = { schemaVersion: 1, ingestionRunId: run?.id ?? null, generatedAt: new Date().toISOString(), dryRun: !publish, totalSources: selected.length, attempted: 0, processed: 0, changed: 0, publishable: 0, published: 0, playlistRefreshRequested: 0, reviewRequired: 0, fetchErrors: 0, escalatedFailures: 0, notificationEvents: 0, maxFetchErrors, failureThreshold, status: "RUNNING", results: [] };
let publicationStore = persistenceEnabled ? null : JSON.parse(await readFile(publicationsPath, "utf8"));
const history = [];

for (const source of selected) {
  let leaseCompleted = false;
  let publicationCommitted = false;
  let attemptPersisted = false;
  try {
  summary.attempted += 1;
  const current = runtimeFestivals.find(({ slug }) => slug === source.festivalSlug);
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
    if (run) {
      await persistAttempt(db, { runId: run.id, festivalSlug: source.festivalSlug, requestedUrl: source.url, httpStatus: Number(error?.httpStatus) || undefined, durationMs: Date.now() - startedAt.getTime(), retryCount: attempts - 1, startedAt, endedAt: new Date(), error: error instanceof Error ? error.message : String(error) });
      attemptPersisted = true;
    }
    const consecutiveFailures = persistenceEnabled ? await ingestionQueries.consecutiveFailures(db, source.festivalSlug) : 1;
    const escalated = consecutiveFailures >= failureThreshold;
    summary.fetchErrors += 1;
    if (escalated) summary.escalatedFailures += 1;
    const lastExtraction = persistenceEnabled ? await ingestionQueries.lastSuccessfulExtraction(db, source.festivalSlug) : null;
    summary.results.push({ festivalSlug: source.festivalSlug, status: escalated ? "escalated_failure" : "fetch_error", extractionPath: source.strategies, manualReviewReason: source.manualReviewReason ?? null, evidenceFields: [], lastSuccessfulExtraction: lastExtraction?.observedAt.toISOString() ?? null, error: error instanceof Error ? error.message : String(error), attempts, consecutiveFailures });
    if (sourceLease) await leaseRenewal.stop();
    if (sourceLease && !await completeSourceLease(db, { ...sourceLease, now: new Date(), outcome: "fetch_error" })) throw new Error("Ingestion source lease is no longer active");
    continue;
  }

  const candidate = extractFestivalCandidate(html, source, fetchedAt);
  const result = evaluateCandidate(current, candidate);
  const status = result.reviewReasons.length ? "review" : result.publishable ? "publishable" : "unchanged";
  const artifact = { status, source: { ...source, httpStatus: response?.status ?? null, finalUrl: response?.url ?? source.url }, result };
  const attempt = run ? await persistAttempt(db, { runId: run.id, festivalSlug: source.festivalSlug, requestedUrl: source.url, finalUrl: response?.url ?? source.url, httpStatus: response?.status ?? null, durationMs: Date.now() - startedAt.getTime(), startedAt, endedAt: new Date(), result }) : null;
  if (attempt) attemptPersisted = true;
  await writeFile(path.join(outputDirectory, `${source.festivalSlug}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  summary.processed += 1;
  if (result.changes.length) summary.changed += 1;
  if (result.publishable) summary.publishable += 1;
  if (result.reviewReasons.length) summary.reviewRequired += 1;
  let outcome = result.changes.length ? (result.reviewReasons.length ? "review_required" : "dry_run") : "unchanged";
  let catalogPublication = null;
  if (publish && result.publishable && !result.reviewReasons.length) {
    leaseRenewal?.assertActive();
    const stagedNotificationEvents = sourceLease ? notificationEventsForChanges(current, result.changes, fetchedAt) : undefined;
    catalogPublication = attempt
      ? await publishIngestionResult(db, { attemptId: attempt.id, result, sourceCommit: process.env.GITHUB_SHA || "local", ...(sourceLease ? { sourceLease, notificationEvents: stagedNotificationEvents } : {}) })
      : null;
    let fileChanged = false;
    if (!persistenceEnabled) {
      const nextStore = applyPublication(publicationStore, current, result);
      fileChanged = JSON.stringify(nextStore) !== JSON.stringify(publicationStore);
      if (fileChanged) publicationStore = nextStore;
    }
    if (catalogPublication || (!persistenceEnabled && fileChanged)) {
      publicationCommitted = Boolean(catalogPublication);
      if (dbDue) summary.notificationEvents += uniqueNotificationEvents(stagedNotificationEvents).length;
      summary.published += 1;
      if (catalogPublication?.playlistRefreshRequested) summary.playlistRefreshRequested += 1;
      outcome = "published";
      // Do not call external notification storage until a committed catalog
      // change is acknowledged; delivery failure must not schedule a retry.
      if (sourceLease) {
        await leaseRenewal.stop();
        if (!await completeSourceLease(db, { ...sourceLease, now: new Date(), outcome: "success" })) throw new Error("Ingestion source lease is no longer active");
        leaseCompleted = true;
      }
      if (!dbDue && notificationDeliveryEnabled) {
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
  summary.results.push({ festivalSlug: source.festivalSlug, status, outcome, catalogPublicationId: catalogPublication?.id ?? null, playlistRefreshRequested: catalogPublication?.playlistRefreshRequested ?? false, catalogFields: catalogPublication?.fields ?? [], extractionPath: source.strategies, manualReviewReason: source.manualReviewReason ?? null, evidenceFields: candidate.evidence.map(({ field }) => field), lastSuccessfulExtraction: lastExtraction?.observedAt.toISOString() ?? (candidate.evidence.length ? fetchedAt : null), changes: result.changes.length, reviewReasons: result.reviewReasons });
  if (sourceLease && !leaseCompleted) {
    await leaseRenewal.stop();
    if (!await completeSourceLease(db, { ...sourceLease, now: new Date(), outcome: "success" })) throw new Error("Ingestion source lease is no longer active");
    leaseCompleted = true;
  }
  } catch (error) {
    // Preserve a terminal run even if lease cleanup itself fails. A committed
    // publication must never be converted into a parser backoff retry.
    try { await leaseRenewal?.stop(); } catch { /* preserve the original error; cleanup remains fenced */ }
    try {
      if (run && sourceLease) await db.ingestionRun.update({ where: { id: run.id }, data: { status: "FAILED", endedAt: new Date(), failed: 1 } });
    } finally {
      if (sourceLease && !leaseCompleted) await completeSourceLease(db, { ...sourceLease, now: new Date(), outcome: publicationCommitted ? "success" : attemptPersisted ? "parser_error" : "pre_attempt_error" });
    }
    throw error;
  }
}

if (run) {
  try {
    await finishIngestionRun(db, run.id);
  } catch (error) {
    if (dbDue) await db.ingestionRun.update({ where: { id: run.id }, data: { status: "FAILED", endedAt: new Date(), failed: 1 } });
    throw error;
  }
}
summary.status = summary.fetchErrors === 0 ? "COMPLETED" : summary.fetchErrors <= maxFetchErrors && summary.escalatedFailures === 0 ? "PARTIAL" : "FAILED";
if (publish && !persistenceEnabled) await writeFile(publicationsPath, `${JSON.stringify(publicationStore, null, 2)}\n`);
if (!persistenceEnabled && history.length) await appendFile(historyPath, `${history.map((record) => JSON.stringify(record)).join("\n")}\n`);
await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
if (summary.status === "FAILED") process.exitCode = 2;
if (persistenceEnabled) await db.$disconnect();
