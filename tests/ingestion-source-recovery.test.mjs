import assert from "node:assert/strict";
import test from "node:test";
import { parserSource as getFestivalSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { isSourceDue } from "../lib/ingestion/schedule.ts";

test("2000trees adapter extracts an edition banner from synthetic source configuration", () => {
  const source = getFestivalSource("2000trees");
  const candidate = extractFestivalCandidate('<p class="alt-subheading">7TH - 10TH JULY 2027</p>', source, "2026-09-01T00:00:00Z");
  assert.equal(candidate.startDate, "2027-07-07");
  assert.equal(candidate.endDate, "2027-07-10");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate"]);
});

test("2000trees July dates do not shift at local midnight in positive-offset timezones", () => {
  const source = getFestivalSource("2000trees");
  const originalTimeZone = process.env.TZ;
  try {
    for (const timeZone of ["UTC", "Europe/Berlin", "Pacific/Auckland"]) {
      process.env.TZ = timeZone;
      const candidate = extractFestivalCandidate('<p class="alt-subheading">7TH - 10TH JULY 2027</p>', source, "2026-09-01T00:00:00Z");
      assert.equal(candidate.startDate, "2027-07-07", timeZone);
      assert.equal(candidate.endDate, "2027-07-10", timeZone);
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test("disabled archived sources are never due", () => {
  const source = getFestivalSource("synthetic-disabled", { enabled: false, strategies: ["manual_review"], refreshPolicy: "archived" });
  assert.equal(isSourceDue(source, new Date("2026-09-01T00:00:00Z")), false);
});
