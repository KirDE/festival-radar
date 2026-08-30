import path from "node:path";
import process from "node:process";
import { festivals } from "../data/festivals.ts";
import { festivalSources } from "../data/festival-sources.ts";
import { runIngestion } from "../lib/ingestion/run.ts";
import { dueFestivalSources } from "../lib/ingestion/schedule.ts";

const args = new Set(process.argv.slice(2));
const value = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const slug = value("slug");
const outputDirectory = path.resolve(value("output") || "outputs/ingestion");
const stateFile = path.resolve(value("state") || path.join(outputDirectory, "source-state.json"));
const failureThreshold = Number(value("failure-threshold") || process.env.INGESTION_FAILURE_THRESHOLD || 3);
if (!Number.isInteger(failureThreshold) || failureThreshold < 1) throw new Error("failure-threshold must be a positive integer");
const eligible = args.has("--due") ? dueFestivalSources(festivalSources) : festivalSources.filter((source) => source.enabled);
const selected = eligible.filter((source) => !slug || source.festivalSlug === slug);
if (!selected.length) throw new Error(slug ? `Unknown, disabled, or not-due festival source: ${slug}` : "No enabled festival sources");

const summary = await runIngestion({ sources: selected, festivals, outputDirectory, stateFile, failureThreshold });
console.log(JSON.stringify(summary));
if (summary.status === "degraded") process.stdout.write(`::warning::Festival ingestion degraded: ${summary.fetchErrors} source(s) failed below escalation threshold ${failureThreshold}.\n`);
if (summary.status === "failed") process.exitCode = 2;
