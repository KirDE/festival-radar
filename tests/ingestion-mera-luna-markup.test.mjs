import assert from "node:assert/strict";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const markup = `
  <div class="m0010_globalheader__logo-subline">07. &amp; 08. August 2027 ┼ Flugplatz Hildesheim Drispenstedt</div>
  <h2 class="m0121b_lineuphometext_v2__headline">Line-Up 2027</h2>
  <lineup-block class="m0121b_lineuphometext_v2__block m0121b_lineuphometext_v2__block--size-XXL">
    <a href="/line-up/act/vnv-nation/"><span>VNV NATION</span></a>
    <a href="/line-up/act/the-sisters-of-mercy/"><span>THE SISTERS OF MERCY</span></a>
    <a href="/line-up/act/feuerschwanz/"><span>FEUERSCHWANZ</span></a>
  </lineup-block>
  <a href="/news/not-an-artist">Not an artist</a>`;

test("M'era Luna extracts its verified 2027 dates and official act links", () => {
  const source = getFestivalSource("mera-luna");
  assert.deepEqual(source?.strategies, ["official_markup"]);
  assert.equal(source?.refreshPolicy, "daily");
  const candidate = extractFestivalCandidate(markup, source, "2026-09-18T16:30:00Z");
  assert.equal(candidate.startDate, "2027-08-07");
  assert.equal(candidate.endDate, "2027-08-08");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.headliners, undefined);
  assert.deepEqual(candidate.lineup, ["VNV Nation", "The Sisters of Mercy", "Feuerschwanz"]);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "lineup"]);
});

test("M'era Luna fails closed without an edition-matched heading and official act links", () => {
  const source = getFestivalSource("mera-luna");
  const candidate = extractFestivalCandidate(markup.replace("Line-Up 2027", "Line-Up 2026"), source, "2026-09-18T16:30:00Z");
  assert.deepEqual(candidate.evidence, []);
  assert.match(candidate.warnings[0], /found no trustworthy fields/);
});
