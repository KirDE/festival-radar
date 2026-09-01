import assert from "node:assert/strict";
import { test } from "node:test";
import { archivedEditions, festivalEditions, getFestivalEdition, getEditionsForYear, hasEditionSpecificOfficialEvidence, trackedFutureEditions } from "../data/editions.ts";

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

test("future records require positive edition-specific official evidence", () => {
  for (const item of trackedFutureEditions) {
    assert.equal(item.recordState, "tracking");
    assert.equal(hasEditionSpecificOfficialEvidence(item), true);
  }

  const unsupported = {
    ...archivedEditions[0],
    editionYear: 2028,
    recordState: "tracking",
    provenance: [{ field: "edition", url: "https://www.wacken.com/en/", checkedAt: "2026-08-30T00:00:00Z", note: "Official site checked; no 2028 edition has been announced." }],
  };
  assert.equal(hasEditionSpecificOfficialEvidence(unsupported), false);
});

test("cross-year lookup cannot overwrite the current edition", () => {
  assert.equal(getFestivalEdition("wacken-open-air", 2026)?.recordState, "archived");
  assert.equal(getFestivalEdition("wacken-open-air", 2027)?.recordState, "current");
  assert.equal(getFestivalEdition("wacken-open-air", 2028), undefined);
  assert.equal(getEditionsForYear(2028).length, 0);
  assert.equal(getEditionsForYear(2026).length, 1);
  assert.equal(getFestivalEdition("wacken-open-air", 2099), undefined);
});
