import assert from "node:assert/strict";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const markup = `
  <meta name="description" content="18. – 20. Juni 2027 // Neuhausen ob Eck">
  <h2 class="m0121b_lineuphometext_v2__headline">Line-Up 2027</h2>
  <lineup-block class="m0121b_lineuphometext_v2__block m0121b_lineuphometext_v2__block--size-XXL">
    <a href="/line-up/act/muse/"><span>MUSE</span></a>
    <a href="/line-up/act/mgk/"><span>MGK</span></a>
    <a href="/line-up/act/phoebe-bridgers/"><span>PHOEBE BRIDGERS</span></a>
  </lineup-block>
  <lineup-block class="m0121b_lineuphometext_v2__block m0121b_lineuphometext_v2__block--size-L">
    <a href="/line-up/act/pierce-the-veil/"><span>PIERCE THE VEIL</span></a>
    <a href="/line-up/act/i-prevail/"><span>I PREVAIL</span></a>
    <a href="/line-up/act/feine-sahne-fischfilet/"><span>FEINE SAHNE FISCHFILET</span></a>
  </lineup-block>
  <a href="/news/not-an-artist">Not an artist</a>`;

for (const slug of ["hurricane", "southside"]) {
  test(`${slug} extracts the verified 2027 lineup from official FKP act links`, () => {
    const source = getFestivalSource(slug);
    assert.deepEqual(source?.strategies, ["official_markup"]);
    assert.equal(source?.refreshPolicy, "daily");
    const candidate = extractFestivalCandidate(markup, source, "2026-09-16T10:13:00Z");
    assert.equal(candidate.startDate, "2027-06-18");
    assert.equal(candidate.endDate, "2027-06-20");
    assert.deepEqual(candidate.observedEditionYears, [2027]);
    assert.deepEqual(candidate.headliners, ["Muse", "MGK", "Phoebe Bridgers"]);
    assert.deepEqual(candidate.lineup, ["Pierce the Veil", "I Prevail", "Feine Sahne Fischfilet"]);
    assert.deepEqual(candidate.warnings, []);
    assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "headliners", "lineup"]);
  });

  test(`${slug} fails closed without an edition-matched heading and tiered act links`, () => {
    const source = getFestivalSource(slug);
    const candidate = extractFestivalCandidate(markup.replace("Line-Up 2027", "Line-Up 2026"), source, "2026-09-16T10:13:00Z");
    assert.deepEqual(candidate.evidence, []);
    assert.match(candidate.warnings[0], /found no trustworthy fields/);
  });
}
