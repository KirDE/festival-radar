import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import timetableData from "../data/timetables.json" with { type: "json" };
import { festivals } from "../data/festivals.ts";
import { timetableDocumentSchema, validateFestivalTimetable } from "../lib/timetables.ts";

const inputPath = process.argv.find((value) => value.startsWith("--input="))?.slice(8);
const checkOnly = process.argv.includes("--check");
if (!inputPath) throw new Error("Usage: npm run timetables:import -- --input=/path/to/reviewed.json [--check]");

const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
const slug = input.festivalSlug;
const festival = festivals.find((item) => item.slug === slug);
if (!festival) throw new Error(`Unknown festival: ${slug}`);
const entries = validateFestivalTimetable(festival, input.entries);
if (new Set(entries.map(({ timeZone }) => timeZone)).size !== 1) throw new Error("A festival timetable must use one IANA timezone");

const document = timetableDocumentSchema.parse(timetableData);
const next = timetableDocumentSchema.parse({ ...document, festivals: { ...document.festivals, [slug]: entries } });
const summary = { festivalSlug: slug, performances: entries.length, cancelled: entries.filter(({ status }) => status === "cancelled").length, sourceUrls: [...new Set(entries.map(({ sourceUrl }) => sourceUrl))], checkOnly };
if (!checkOnly) {
  const destination = path.resolve("data/timetables.json");
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, destination);
}
console.log(JSON.stringify(summary));
