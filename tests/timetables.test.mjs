import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { festival } from "./support/catalog.ts";
import { findTimetableConflicts, groupTimetable, validateFestivalTimetable } from "../lib/timetables.ts";

const base = { date: "2027-06-10", stage: "Faster", start: "18:30", artist: "Sample Artist", timeZone: "Europe/Berlin", status: "scheduled", sourceUrl: "https://festival.example.test/", observedAt: "2027-06-01T10:00:00.000Z" };

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
  assert.equal(grouped[0].date, "2027-06-10");
  assert.deepEqual(grouped[0].stages.map(({ stage }) => stage), ["Faster", "Louder"]);
  assert.deepEqual(grouped[0].stages[0].entries.map(({ artist }) => artist), ["Earlier", "Later"]);
});

test("conflicting scheduled rows are rejected while cancellations remain visible", () => {
  assert.equal(findTimetableConflicts([base, { ...base, artist: "Other artist" }]).length, 1);
  assert.throws(() => validateFestivalTimetable(festival, [base, { ...base, artist: "Other artist" }]), /conflict/);
  assert.doesNotThrow(() => validateFestivalTimetable(festival, [base, { ...base, artist: "Other artist", status: "cancelled" }]));
});

test("the DB importer rejects missing database configuration without mutating its input", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-timetable-"));
  const input = path.join(directory, "input.json");
  await writeFile(input, JSON.stringify({ festivalSlug: festival.slug, entries: [base] }));
  try {
    const before = await readFile(input, "utf8");
    const result = spawnSync(process.execPath, ["scripts/import-timetable.mjs", `--input=${input}`, "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_URL/);
    assert.equal(await readFile(input, "utf8"), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
