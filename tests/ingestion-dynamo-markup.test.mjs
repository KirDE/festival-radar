import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { parserSource } from "./support/parser-source.ts";

const url = "https://dynamo-metalfest.nl/first-names-dmf-27/";
const at = "2026-10-06T19:40:00Z";
const source = (overrides = {}) => parserSource("dynamo-metal-fest", { url, ...overrides });
const extract = (html, overrides) => extractFestivalCandidate(html, source(overrides), at);
const fixture = await readFile(new URL("./fixtures/official-markup/dynamo-first-names-2027.html", import.meta.url), "utf8");
const artists = ["Architects", "Mercyful Fate", "Cavalera", "Corrosion of Conformity", "Hypocrisy", "Madball", "Sylosis", "I Am Morbid", "Left to Suffer"];
const current = { slug: "dynamo-metal-fest", name: "Dynamo Metalfest", editionYear: 2027, country: "NL", officialUrl: "https://dynamo-metalfest.nl/", status: "announced", headliners: [], lineup: [] };

const noEvidence = (candidate) => {
  assert.deepEqual(candidate.evidence, []);
  assert.equal(candidate.lineup, undefined);
  assert.deepEqual(evaluateCandidate({ ...current, lineup: artists }, candidate).changes, []);
  assert.match(candidate.warnings[0], /found no trustworthy fields/);
};

test("exact announcement extracts 2027 dates, Eindhoven, and nine artist identities, not set titles or headliners", () => {
  const candidate = extract(fixture);
  assert.equal(candidate.startDate, "2027-08-13");
  assert.equal(candidate.endDate, "2027-08-15");
  assert.equal(candidate.city, "Eindhoven");
  assert.deepEqual(candidate.lineup, artists);
  assert.equal(candidate.headliners, undefined);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field, sourceUrl }) => [field, sourceUrl]), ["startDate", "endDate", "city", "lineup"].map((field) => [field, url]));
  assert.match(candidate.warnings.join('; '), /Agent review required before lineup-triggered provider activity/);
  assert.equal(evaluateCandidate(current, candidate).publishable, false);
  assert.ok(candidate.evidence[0].excerpt.includes("CAVALERA – CHAOS A.D."));
  assert.deepEqual(evaluateCandidate(current, candidate).changes.filter(({ kind }) => kind === "artist_added").map(({ after }) => after), artists);
});

test("source URL, canonical URL, heading and post identity must agree", () => {
  for (const sourceUrl of ["https://dynamo-metalfest.nl/", "https://dynamo-metalfest.nl/early-bird-tickets-are-live/", "https://attacker.example/first-names-dmf-27/", url + "?archive=2026"]) {
    noEvidence(extract(fixture, { url: sourceUrl }));
  }
  noEvidence(extract(fixture, { editionYear: 2026 }));
  for (const html of [fixture.replace("FIRST NAMES DMF 27 - Dynamo Metalfest", "FIRST NAMES DMF 26 - Dynamo Metalfest"), fixture.replace('rel="canonical"', 'rel="alternate"'), fixture.replace('<h1 class="elementor-heading-title elementor-size-default">FIRST NAMES DMF 27</h1>', '<h1>FIRST NAMES DMF 26</h1>'), fixture.replace('data-widget_type="theme-post-content.default"', 'data-widget_type="footer.default"')]) noEvidence(extract(html));
});

test("partial, empty, mismatched and ambiguous lineups cannot propose removals", () => {
  const failures = ["", fixture.slice(0, fixture.indexOf("<strong>")), fixture.replace("<br>LEFT TO SUFFER", ""), fixture.replace("<br>LEFT TO SUFFER", "<br>ARCHITECTS"), fixture.replace("CAVALERA – CHAOS A.D.", "CAVALERA – UNKNOWN SET"), fixture.replace("MADBALL – D.O.A. &#8217;95 SET", "MADBALL – D.O.A. &#8217;94 SET"), fixture.replace("I AM MORBID – D.O.A. &#8217;91", "I AM MORBID – D.O.A. &#8217;92"), fixture.replace("<br>LEFT TO SUFFER", "<br>LEFT TO SUFFER<br>EXTRA ARTIST"), fixture.replace("</strong>", "")];
  for (const html of failures) noEvidence(extract(html));
});

test("dates are taken only from 2027 article prose, with consecutive valid August days", () => {
  for (const html of [fixture.replace("August 13, 14 &amp; 15, 2027", "August 13, 14 &amp; 15, 2026"), fixture.replace("August 13, 14 &amp; 15, 2027", "August 13, 14 &amp; 16, 2027"), fixture.replace("August 13, 14 &amp; 15, 2027", "August 30, 31 &amp; 32, 2027"), fixture.replace("Eindhoven on August", "Amsterdam on August"), fixture.replace("Dynamo Metalfest 2027!", "Dynamo Metalfest 2026!")]) noEvidence(extract(html));
  const moved = extract(fixture.replace("August 13, 14 &amp; 15, 2027", "August 20, 21 &amp; 22, 2027"));
  assert.equal(moved.startDate, "2027-08-20");
  assert.equal(moved.endDate, "2027-08-22");
  assert.deepEqual(moved.lineup, artists);
});
