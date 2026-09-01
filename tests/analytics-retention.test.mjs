import assert from "node:assert/strict";
import test from "node:test";
import { analyticsCutoff, pruneAnalytics, retentionDaysFrom } from "../lib/analytics-retention.ts";

test("retention configuration accepts only whole days in the supported range", () => {
  assert.equal(retentionDaysFrom(undefined), 90);
  assert.equal(retentionDaysFrom("1"), 1);
  assert.equal(retentionDaysFrom("730"), 730);
  for (const value of ["0", "731", "1.5", "90days", "", "-2"]) {
    assert.throws(() => retentionDaysFrom(value), /integer from 1 to 730/);
  }
});

test("cutoff is an exclusive UTC day boundary", () => {
  assert.equal(analyticsCutoff(90, new Date("2026-09-01T23:59:59Z")).toISOString(), "2026-06-03T00:00:00.000Z");
});

test("pruning uses the exclusive cutoff and reports deleted rows", async () => {
  let received;
  const db = { analyticsDaily: { async deleteMany(args) { received = args; return { count: 2 }; } } };
  const result = await pruneAnalytics(db, "90", new Date("2026-09-01T12:00:00Z"));
  assert.deepEqual(received, { where: { day: { lt: new Date("2026-06-03T00:00:00.000Z") } } });
  assert.deepEqual(result, { deletedAggregateRows: 2, cutoff: "2026-06-03T00:00:00.000Z", retentionDays: 90 });
});

test("zero-deletion pruning is successful and idempotent", async () => {
  const db = { analyticsDaily: { async deleteMany() { return { count: 0 }; } } };
  assert.equal((await pruneAnalytics(db, "30")).deletedAggregateRows, 0);
  assert.equal((await pruneAnalytics(db, "30")).deletedAggregateRows, 0);
});
