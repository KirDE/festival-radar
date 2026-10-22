import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { parserSource as getFestivalSource } from "./support/parser-source.ts";
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

const liveMarkup = readFileSync(new URL("./fixtures/mera-luna-2027-partial.html", import.meta.url), "utf8");
const saved = JSON.parse(readFileSync(new URL("./fixtures/mera-luna-2027-current.json", import.meta.url), "utf8"));
const current = { ...saved, slug: "mera-luna", editionYear: saved.year };
const parse = (html) => extractFestivalCandidate(html, getFestivalSource("mera-luna"), "2026-10-22T09:11:12Z");

test("M'era Luna real incomplete homepage neither imports TBA nor removes saved artists", () => {
  const candidate = parse(liveMarkup);
  assert.equal(candidate.lineup.length, 31);
  assert.ok(!candidate.lineup.includes("- Tba -"));
  assert.ok(!candidate.lineup.includes("Das Ich"));
  assert.equal(candidate.artistListMode, "additive");
  const result = evaluateCandidate(current, candidate);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.reviewReasons, []);
  assert.equal(result.publishable, false);
  assert.equal(current.lineup.length, 33);
});

test("M'era Luna later incomplete wave adds a real act without deleting reviewed names", () => {
  const candidate = parse(liveMarkup.replace('<span>- TBA -</span>', '<span> T.B.A. </span>').replace('</lineup-block>', '<a href="/line-up/act/new-official-act/">NEW OFFICIAL ACT</a></lineup-block>'));
  const result = evaluateCandidate(current, candidate);
  assert.deepEqual(result.changes.map(({kind, after}) => ({kind, after})), [{kind:"artist_added", after:"New Official Act"}]);
  assert.ok(candidate.lineup.includes("[:sitd:]"));
  assert.ok(candidate.lineup.includes("A.a. Williams"));
});

test("M'era Luna placeholder-only and wrong edition pages fail closed", () => {
  for (const html of [liveMarkup.replace(/<a\b[^>]*href="\/line-up\/act\/(?!tba\/)[^>]*>[\s\S]*?<\/a>/gi, ''), liveMarkup.replace('Line-Up 2027', 'Line-Up 2026')]) {
    const candidate = parse(html);
    assert.equal(candidate.lineup, undefined);
    assert.ok(candidate.warnings.length);
  }
});

test("M'era Luna a list without a placeholder retains removal review", () => {
  const candidate = parse(liveMarkup.replace(/<a href="\/line-up\/act\/tba\/">[\s\S]*?<\/a>/, ''));
  assert.equal(candidate.artistListMode, undefined);
  const result = evaluateCandidate(current, candidate);
  assert.ok(result.changes.some(({kind,before}) => kind === 'artist_removed' && before === 'Das Ich'));
  assert.ok(result.reviewReasons.includes('Removals require confirmation'));
  assert.equal(result.publishable, false);
});

test("M'era Luna recognizes placeholder labels on later official slot URLs and editions", () => {
  const later = liveMarkup.replaceAll("2027", "2028").replace('/act/tba/', '/act/to-be-announced/').replace('<span>- TBA -</span>', '<span> — T.B.A. — </span>');
  const candidate = extractFestivalCandidate(later, getFestivalSource("mera-luna", {editionYear:2028}), "2027-10-22T09:11:12Z");
  assert.deepEqual(candidate.observedEditionYears, [2028]);
  assert.equal(candidate.startDate, "2028-08-07");
  assert.equal(candidate.lineup.length, 31);
  assert.equal(candidate.artistListMode, "additive");
});

test("M'era Luna ignores TBA navigation outside the artist grid", () => {
  const candidate = parse(markup + '<a href="/line-up/act/tba/">- TBA -</a>');
  assert.equal(candidate.artistListMode, undefined);
  assert.equal(candidate.lineup.length, 3);
});
