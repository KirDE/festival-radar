import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const fixture = (slug) => readFile(new URL(`./fixtures/official-markup/${slug}.html`, import.meta.url), "utf8");
const observedAt = "2026-08-30T03:42:00.000Z";

test("Pinkpop official markup extracts the published range and city", async () => {
  const result = extractFestivalCandidate(await fixture("pinkpop"), getFestivalSource("pinkpop"), observedAt);
  assert.equal(result.startDate, "2027-06-18");
  assert.equal(result.endDate, "2027-06-20");
  assert.equal(result.city, "Landgraaf");
  assert.deepEqual(result.warnings, []);
});

test("Tuska official title extracts the published range", async () => {
  const result = extractFestivalCandidate(await fixture("tuska"), getFestivalSource("tuska"), observedAt);
  assert.equal(result.startDate, "2027-07-02");
  assert.equal(result.endDate, "2027-07-04");
});

for (const slug of ["full-force", "motocultor", "leyendas-del-rock", "mad-cool", "firenze-rocks", "pistoia-blues", "dynamo-metal-fest", "copenhell", "rockstadt"]) {
  test(`${slug} is explicit manual-review with a reason and weekly cadence`, async () => {
    const source = getFestivalSource(slug);
    assert.equal(source.refreshPolicy, "weekly");
    assert.deepEqual(source.strategies, ["manual_review"]);
    const result = extractFestivalCandidate(await fixture(slug), source, observedAt);
    assert.equal(result.evidence.length, 0);
    assert.match(result.warnings[0], /^Manual review only: .{20,}/);
  });
}
