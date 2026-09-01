import assert from "node:assert/strict";
import test from "node:test";
import { festivals } from "../data/festivals.ts";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { isSourceDue } from "../lib/ingestion/schedule.ts";

test("2000trees uses the active official domain and extracts its edition banner", () => {
  const festival = festivals.find(({ slug }) => slug === "2000trees");
  const source = getFestivalSource("2000trees");
  assert.equal(festival?.officialUrl, "https://2000trees.co.uk/");
  assert.equal(source?.url, festival?.officialUrl);
  assert.deepEqual(source?.strategies, ["official_markup"]);
  const candidate = extractFestivalCandidate('<p class="alt-subheading">7TH - 10TH JULY 2027</p>', source, "2026-09-01T00:00:00Z");
  assert.equal(candidate.startDate, "2027-07-07");
  assert.equal(candidate.endDate, "2027-07-10");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate"]);
});

test("the defunct MetalDays source is retained as explicit disabled provenance", () => {
  const source = getFestivalSource("metaldays");
  assert.equal(source?.enabled, false);
  assert.equal(source?.refreshPolicy, "archived");
  assert.deepEqual(source?.strategies, ["manual_review"]);
  assert.match(source?.manualReviewReason || "", /ended MetalDays in 2024/);
  assert.equal(isSourceDue(source, new Date("2026-09-01T00:00:00Z")), false);
});
