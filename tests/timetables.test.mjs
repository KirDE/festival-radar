import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { festivals } from "../data/festivals.ts";
import { findTimetableConflicts, groupTimetable, validateFestivalTimetable } from "../lib/timetables.ts";

const festival = festivals.find(({ slug }) => slug === "wacken-open-air");
const base = { date: "2027-07-28", stage: "Faster", start: "18:30", artist: "Electric Callboy", timeZone: "Europe/Berlin", status: "scheduled", sourceUrl: "https://www.wacken.com/", observedAt: "2027-07-01T10:00:00.000Z" };

test("populated timetables validate provenance, dates and timezone", () => {
  assert.ok(festival);
  assert.deepEqual(validateFestivalTimetable(festival, [base]), [base]);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, sourceUrl: "https://example.test/" }]), /not under the festival official URL/);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, timeZone: "Moon/Base" }]), /IANA/);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, date: "2027-02-30" }]), /real calendar date/);
  assert.throws(() => validateFestivalTimetable(festival, [{ ...base, date: "2027-08-01" }]), /follows festival end/);
  assert.throws(() => validateFestivalTimetable(festival, [base, base]), /duplicate timetable row/);
});

test("rows are grouped by date and stage and sorted by local start time", () => {
  const grouped = groupTimetable([
    { ...base, start: "20:00", artist: "Later" },
    { ...base, stage: "Louder", start: "17:00", artist: "Other stage" },
    { ...base, start: "17:30", artist: "Earlier" },
  ]);
  assert.equal(grouped[0].date, "2027-07-28");
  assert.deepEqual(grouped[0].stages.map(({ stage }) => stage), ["Faster", "Louder"]);
  assert.deepEqual(grouped[0].stages[0].entries.map(({ artist }) => artist), ["Earlier", "Later"]);
});

test("conflicting scheduled rows are rejected while cancellations remain visible", () => {
  assert.equal(findTimetableConflicts([base, { ...base, artist: "Other artist" }]).length, 1);
  assert.throws(() => validateFestivalTimetable(festival, [base, { ...base, artist: "Other artist" }]), /conflict/);
  assert.doesNotThrow(() => validateFestivalTimetable(festival, [base, { ...base, artist: "Other artist", status: "cancelled" }]));
});

test("the reviewed importer validates without mutating tracked timetable data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-timetable-"));
  const input = path.join(directory, "input.json");
  await writeFile(input, JSON.stringify({ festivalSlug: festival.slug, entries: [base] }));
  const before = await readFile(new URL("../data/timetables.json", import.meta.url), "utf8");
  const result = spawnSync(process.execPath, ["scripts/import-timetable.mjs", `--input=${input}`, "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).performances, 1);
  assert.equal(await readFile(new URL("../data/timetables.json", import.meta.url), "utf8"), before);
});

test("the empty catalog explicitly represents no verified published timetable", () => {
  assert.ok(festivals.every(({ timetable }) => timetable === undefined || timetable.length > 0));
});
