import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { festivals } from "../data/festivals.ts";
import { festivalSources } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { dueFestivalSources } from "../lib/ingestion/schedule.ts";
import { applyPublication, historyRecord } from "../lib/ingestion/publication.ts";

const args = new Set(process.argv.slice(2));
const slugArg = process.argv.find((value) => value.startsWith("--slug="))?.slice(7);
const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
const outputDirectory = path.resolve(outputArg || "outputs/ingestion");
const publicationsPath = path.resolve(process.argv.find((value) => value.startsWith("--publications="))?.slice(15) || "data/ingestion-publications.json");
const historyPath = path.resolve(process.argv.find((value) => value.startsWith("--history="))?.slice(10) || "data/ingestion-history.jsonl");
const fixturePath = process.argv.find((value) => value.startsWith("--fixture="))?.slice(10);
const publish = args.has("--publish");
const eligible = args.has("--due") ? dueFestivalSources(festivalSources) : festivalSources.filter((source) => source.enabled);
const selected = eligible.filter((source) => !slugArg || source.festivalSlug === slugArg);
if (selected.length === 0) throw new Error(slugArg ? `Unknown or disabled festival source: ${slugArg}` : "No enabled festival sources");

await mkdir(outputDirectory, { recursive: true });
const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), dryRun: !publish, processed: 0, changed: 0, publishable: 0, published: 0, reviewRequired: 0, fetchErrors: 0, results: [] };
let publicationStore = JSON.parse(await readFile(publicationsPath, "utf8"));
const history = [];

for (const source of selected) {
  const current = festivals.find(({ slug }) => slug === source.festivalSlug);
  if (!current) throw new Error(`No current festival for ${source.festivalSlug}`);
  const fetchedAt = new Date().toISOString();
  try {
    const response = fixturePath ? null : await fetch(source.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "FestivalRadarBot/1.0 (+https://festivals.kir-it.de/)" },
    });
    if (response && !response.ok) throw new Error(`HTTP ${response.status}`);
    const html = fixturePath ? await readFile(path.resolve(fixturePath), "utf8") : await response.text();
    const candidate = extractFestivalCandidate(html, source, fetchedAt);
    const result = evaluateCandidate(current, candidate);
    const status = result.reviewReasons.length ? "review" : result.publishable ? "publishable" : "unchanged";
    const artifact = { status, source: { ...source, httpStatus: response?.status ?? null, finalUrl: response?.url ?? source.url }, result };
    await writeFile(path.join(outputDirectory, `${source.festivalSlug}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    summary.processed += 1;
    if (result.changes.length) summary.changed += 1;
    if (result.publishable) summary.publishable += 1;
    if (result.reviewReasons.length) summary.reviewRequired += 1;
    let outcome = result.changes.length ? (result.reviewReasons.length ? "review_required" : "dry_run") : "unchanged";
    if (publish && result.publishable && !result.reviewReasons.length) {
      const nextStore = applyPublication(publicationStore, current, result);
      if (JSON.stringify(nextStore) !== JSON.stringify(publicationStore)) { publicationStore = nextStore; summary.published += 1; outcome = "published"; }
      else outcome = "unchanged";
    }
    history.push(historyRecord(result, outcome));
    summary.results.push({ festivalSlug: source.festivalSlug, status, outcome, changes: result.changes.length, reviewReasons: result.reviewReasons });
  } catch (error) {
    summary.fetchErrors += 1;
    summary.results.push({ festivalSlug: source.festivalSlug, status: "fetch_error", error: error instanceof Error ? error.message : String(error) });
  }
}

if (publish) await writeFile(publicationsPath, `${JSON.stringify(publicationStore, null, 2)}\n`);
if (history.length) await appendFile(historyPath, `${history.map((record) => JSON.stringify(record)).join("\n")}\n`);

await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
if (summary.fetchErrors) process.exitCode = 2;
