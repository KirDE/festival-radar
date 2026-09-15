import assert from "node:assert/strict";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const markup = `
  <title>Rock im Park | 4 - 6 Juni 2027 | Nürnberg</title>
  <article class="lineup-day">
    <span class="headliner" aria-label="Headliner">
      <span class="name artist-label al--logo"><a href="/line-up/headliner"><img title="Headliner One" alt="Logo Headliner One"></a></span>
    </span>
    <span class="second" aria-label="Secondary">
      <span class="name artist-label"><a href="/line-up/band-a"><span>Band A</span></a></span>
      <span class="name artist-label"><a href="/line-up/band-b"><span>Band &amp; B</span></a></span>
    </span>
    <div class="special" aria-label="Very special guests">
      <span class="name artist-label al--logo"><a href="/line-up/special"><img alt="Logo Special Guest"></a></span>
    </div>
  </article>
  <a href="/news/not-an-artist">Not an artist</a>`;

for (const slug of ["rock-am-ring", "rock-im-park"]) {
  test(`${slug} uses trusted schedule-aware lineup markup`, () => {
    const source = getFestivalSource(slug);
    assert.deepEqual(source?.strategies, ["official_markup"]);
    const candidate = extractFestivalCandidate(markup, source, "2026-09-15T13:20:00Z");
    assert.equal(candidate.startDate, "2027-06-04");
    assert.equal(candidate.endDate, "2027-06-06");
    assert.deepEqual(candidate.observedEditionYears, [2027]);
    assert.deepEqual(candidate.headliners, ["Headliner One"]);
    assert.deepEqual(candidate.lineup, ["Band A", "Band & B", "Special Guest"]);
    assert.deepEqual(candidate.warnings, []);
    assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "headliners", "lineup"]);
  });
}

test("the adapter fails closed when the official artist links disappear", () => {
  const source = getFestivalSource("rock-im-park");
  const candidate = extractFestivalCandidate("<title>Rock im Park | 4 - 6 Juni 2027 | Nürnberg</title>", source, "2026-09-15T13:20:00Z");
  assert.deepEqual(candidate.evidence, []);
  assert.match(candidate.warnings[0], /found no trustworthy fields/);
});
