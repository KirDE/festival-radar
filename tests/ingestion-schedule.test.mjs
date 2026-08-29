import assert from "node:assert/strict";
import test from "node:test";
import { dueFestivalSources, isSourceDue } from "../lib/ingestion/schedule.ts";

const now = new Date("2026-08-28T21:00:00Z");
const source = (refreshPolicy, lastSuccessfulCheck, enabled = true) => ({
  festivalSlug: refreshPolicy, url: "https://example.com", strategies: ["json_ld_event"],
  refreshPolicy, enabled, lastSuccessfulCheck,
});

test("sources without a successful check are due", () => {
  assert.equal(isSourceDue(source("weekly"), now), true);
});

test("refresh intervals select only due sources", () => {
  const sources = [
    source("daily", "2026-08-27T20:59:59Z"),
    source("every_3_days", "2026-08-27T20:59:59Z"),
    source("weekly", "2026-08-21T20:59:59Z"),
    source("archived", "2026-08-01T00:00:00Z"),
    source("daily", "2026-08-01T00:00:00Z", false),
  ];
  assert.deepEqual(dueFestivalSources(sources, now).map(({ refreshPolicy }) => refreshPolicy), ["daily", "weekly"]);
});

test("invalid timestamps are retried", () => {
  assert.equal(isSourceDue(source("daily", "not-a-date"), now), true);
});
