import assert from "node:assert/strict";
import { test } from "node:test";
import sitemap from "../app/sitemap.ts";
import { generateStaticParams } from "../app/festivals/[slug]/[year]/page.tsx";
import { archivedEditions, festivalEditions, getFestivalEdition, getEditionsForYear, hasEditionSpecificOfficialEvidence, publishableFutureEditions, trackedFutureEditions } from "../data/editions.ts";

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

  const candidate = {
    ...archivedEditions[0],
    editionYear: 2028,
    recordState: "tracking",
    officialUrl: "https://www.wacken.com/",
    provenance: [{ field: "edition", url: "https://www.wacken.com/en/news-details/wacken-open-air-2028/", checkedAt: "2026-08-30T00:00:00Z", note: "Official Wacken Open Air 2028 announcement." }],
  };

  assert.equal(hasEditionSpecificOfficialEvidence(candidate), true);
  assert.deepEqual(publishableFutureEditions([candidate]), [candidate]);
});

test("future edition provenance fails closed", () => {
  const candidate = {
    ...archivedEditions[0],
    editionYear: 2028,
    recordState: "tracking",
    officialUrl: "https://www.wacken.com/",
  };
  const evidence = (url, note = "Official Wacken Open Air 2028 announcement.") => ({
    ...candidate,
    provenance: [{ field: "edition", url, checkedAt: "2026-08-30T00:00:00Z", note }],
  });

  const unsupported = [
    evidence("https://www.wacken.com/en/"),
    evidence("https://www.wacken.com/en/news-details/wacken-open-air-2027/"),
    evidence("https://example.com/wacken-open-air-2028/"),
    evidence("http://www.wacken.com/en/news-details/wacken-open-air-2028/"),
    evidence("not a URL"),
    evidence("https://www.wacken.com/en/news-details/wacken-open-air-2028/", "Official site checked; no 2028 edition has been announced."),
    evidence("https://www.wacken.com/en/news-details/wacken-open-air-2028/", "The 2028 edition has not yet been announced."),
  ];

  for (const item of unsupported) assert.equal(hasEditionSpecificOfficialEvidence(item), false);
  assert.deepEqual(publishableFutureEditions(unsupported), []);
});

test("cross-year lookup cannot overwrite the current edition", () => {
  assert.equal(getFestivalEdition("wacken-open-air", 2026)?.recordState, "archived");
  assert.equal(getFestivalEdition("wacken-open-air", 2027)?.recordState, "current");
  assert.equal(getFestivalEdition("wacken-open-air", 2028), undefined);
  assert.equal(getEditionsForYear(2028).length, 0);
  assert.equal(generateStaticParams().some(({ year }) => year === "2028"), false);
  assert.equal(sitemap().some(({ url }) => url.includes("/2028/")), false);
  assert.equal(getEditionsForYear(2026).length, 1);
  assert.equal(getFestivalEdition("wacken-open-air", 2099), undefined);
});
