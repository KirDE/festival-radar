import assert from "node:assert/strict";
import { test } from "node:test";
import { archivedEditions, festivalEditions, getFestivalEdition, getEditionsForYear, trackedFutureEditions } from "../data/editions.ts";

test("festival editions are unique by festival and year", () => {
  const keys = festivalEditions.map(({ slug, editionYear }) => `${slug}:${editionYear}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("archived editions are immutable provenance-aware snapshots", () => {
  assert.ok(archivedEditions.length > 0);
  for (const item of archivedEditions) {
    assert.equal(item.recordState, "archived");
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.lineup));
    assert.ok(item.snapshotAt);
    assert.ok(item.provenance.length > 0);
    assert.ok(item.provenance.every(({ url }) => url.startsWith("https://")));
  }
});

test("future records never imply unverified dates or lineups", () => {
  assert.ok(trackedFutureEditions.length > 0);
  for (const item of trackedFutureEditions) {
    assert.equal(item.recordState, "tracking");
    assert.equal(item.status, "tba");
    assert.equal(item.startDate, undefined);
    assert.deepEqual(item.headliners, []);
    assert.deepEqual(item.lineup, []);
    assert.ok(item.provenance.some(({ note }) => note.includes("no 2028 dates or artists")));
  }
});

test("cross-year lookup cannot overwrite the current edition", () => {
  assert.equal(getFestivalEdition("wacken-open-air", 2026)?.recordState, "archived");
  assert.equal(getFestivalEdition("wacken-open-air", 2027)?.recordState, "current");
  assert.equal(getFestivalEdition("wacken-open-air", 2028)?.recordState, "tracking");
  assert.equal(getEditionsForYear(2026).length, 1);
  assert.equal(getFestivalEdition("wacken-open-air", 2099), undefined);
});
