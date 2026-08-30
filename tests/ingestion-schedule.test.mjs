import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyFreshnessState, emptyFreshnessState, readFreshnessState, recordCheckResult, writeFreshnessState } from "../lib/ingestion/freshness-state.ts";
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

test("successful checks persist and hydrate after a process restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "festival-freshness-"));
  const statePath = path.join(directory, "freshness.json");
  try {
    const persisted = recordCheckResult(emptyFreshnessState(now), "weekly", "2026-08-28T20:00:00Z", true);
    await writeFreshnessState(statePath, persisted);
    const restartedSources = applyFreshnessState([source("weekly")], await readFreshnessState(statePath));
    assert.equal(restartedSources[0].lastSuccessfulCheck, "2026-08-28T20:00:00Z");
    assert.equal(isSourceDue(restartedSources[0], now), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a fetch failure leaves the previous successful-check timestamp unchanged", () => {
  const before = recordCheckResult(emptyFreshnessState(now), "daily", "2026-08-27T21:00:00Z", true);
  const afterFailure = recordCheckResult(before, "daily", "2026-08-28T21:00:00Z", false);
  assert.deepEqual(afterFailure, before);
  assert.equal(applyFreshnessState([source("daily")], afterFailure)[0].lastSuccessfulCheck, "2026-08-27T21:00:00Z");
});

test("independent daily, three-day and weekly schedules survive hydration", () => {
  let state = emptyFreshnessState(now);
  state = recordCheckResult(state, "daily", "2026-08-27T20:59:59Z", true);
  state = recordCheckResult(state, "every_3_days", "2026-08-27T20:59:59Z", true);
  state = recordCheckResult(state, "weekly", "2026-08-21T20:59:59Z", true);
  const hydrated = applyFreshnessState([source("daily"), source("every_3_days"), source("weekly")], state);
  assert.deepEqual(dueFestivalSources(hydrated, now).map(({ refreshPolicy }) => refreshPolicy), ["daily", "weekly"]);
});
