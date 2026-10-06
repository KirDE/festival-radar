import assert from "node:assert/strict";
import { test } from "node:test";
import { parserSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { sourceParserKey } from "../lib/sources/repository.ts";

const infoUrl = "https://www.jeraonair.nl/en/info/";
const lineupUrl = "https://www.jeraonair.nl/en/line-up/";
const at = "2026-10-06T16:30:00Z";
const names = ["Lorna Shore", "Dropkick Murphys", "Simple Plan", "The Interrupters", "Blood For Blood", "Bodysnatcher", "Comeback Kid", "Drain", "Fit For A King", "From Ashes to New", "grandson", "Guilt Trip", "Jinjer", "John Coffey", "Kanonenfieber", "LOCKED SHUT", "RAT BOY", "Restraining Order", "SPEED", "Static-X", "Terminal Sleep"];
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
const card = (name, index) => `<div class="item" data-title="${name.toLowerCase()}" data-day="" data-order="${index}"><a href="/en/line-up/${slug(name)}/" title="${name}" class="link-icon"><img src="/images/icons/link.svg" alt="link icon"></a><div class="item-popup-link performance" data-band="${index}"><div class="item-image"><img src="/images/band.jpg" alt=""></div><div class="item-text"><span class="title">${name}</span></div></div></div>`;
const info = `<title>Information - Jera On Air 2027 - June 24-25-26</title><nav>History 2025</nav><main><h1>Information</h1><div class="text"><h2>GENERAL</h2><p>Introduction.</p><p>2027&nbsp;is edition&nbsp;#33&nbsp;of Jera On Air and will take place on 24, 25&nbsp;and 26 June.</p></div></main><footer>2026</footer>`;
const lineup = (artists = names) => `<title>Line up - Jera On Air 2027 - June 24-25-26</title><nav><a href="/en/line-up/history/">History 2026</a></nav><main><form class="line-up-header"><h1>Line up</h1></form><div class="line-up-grid tile_grid" id="lineup" aria-live="polite">${artists.map(card).join("")}</div><dialog id="performance-dialog"></dialog><template id="performance-old"><span class="title">Old Band</span></template></main><footer><div class="item" data-title="fake"></div></footer>`;
const source = (url, overrides = {}) => parserSource("jera-on-air", { url, ...overrides });
const extract = (html, url, overrides) => extractFestivalCandidate(html, source(url, overrides), at);
const current = { slug: "jera-on-air", name: "Jera On Air", editionYear: 2027, startDate: "2027-06-24", endDate: "2027-06-26", country: "NL", officialUrl: infoUrl, status: "partial", headliners: [], lineup: names };

test("both official sources register under one explicit adapter and extract disjoint fields", () => {
  assert.equal(sourceParserKey(source(infoUrl)), "official_markup:jera-on-air");
  assert.equal(sourceParserKey(source(lineupUrl)), "official_markup:jera-on-air");
  const dates = extract(info, infoUrl);
  assert.equal(dates.startDate, "2027-06-24");
  assert.equal(dates.endDate, "2027-06-26");
  assert.equal(dates.lineup, undefined);
  assert.deepEqual(dates.evidence.map(({ field }) => field), ["startDate", "endDate"]);
  const artists = extract(lineup(), lineupUrl);
  assert.deepEqual(artists.lineup, names);
  assert.equal(artists.headliners, undefined);
  assert.equal(artists.startDate, undefined);
  assert.deepEqual(artists.observedEditionYears, [2027]);
  assert.deepEqual(artists.evidence.map(({ field }) => field), ["lineup"]);
  assert.deepEqual(evaluateCandidate(current, artists).changes, []);
  const catalogueCase = names.map((name) => ({ "Fit For A King": "Fit for a King", "From Ashes to New": "From Ashes To New", SPEED: "Speed" })[name] ?? name);
  assert.deepEqual(evaluateCandidate({ ...current, lineup: catalogueCase }, artists).changes, []);
  assert.deepEqual(evaluateCandidate(current, dates).changes, []);
  const wrongEdition = evaluateCandidate({ ...current, editionYear: 2028 }, artists);
  assert.equal(wrongEdition.publishable, false);
  assert.match(wrongEdition.reviewReasons.join("; "), /does not match catalogue edition 2028/);
});

test("new artist is publishable once, a missing artist requires review", () => {
  const added = extract(lineup([...names, "New Artist"]), lineupUrl);
  assert.deepEqual(evaluateCandidate(current, added).changes.map(({ kind, after }) => [kind, after]), [["artist_added", "New Artist"]]);
  assert.equal(evaluateCandidate(current, added).publishable, true);
  assert.deepEqual(evaluateCandidate({ ...current, lineup: [...names, "New Artist"] }, added).changes, []);
  const removed = evaluateCandidate(current, extract(lineup(names.slice(1)), lineupUrl));
  assert.equal(removed.publishable, false);
  assert.deepEqual(removed.changes.map(({ kind, before }) => [kind, before]), [["artist_removed", names[0]]]);
});

test("empty, truncated, mismatched, and drifted pages never propose removals", () => {
  const failures = ["", lineup([]), lineup(names.slice(0, 15)), lineup([...names, names[0]]), lineup().replace("data-title=\"lorna shore\"", "data-title=\"wrong\""), lineup().replace("2027 - June", "2026 - June"), lineup().replace('id="lineup"', 'id="other"'), lineup().replace('<dialog id="performance-dialog">', '<dialog id="other">')];
  for (const html of failures) {
    const candidate = extract(html, lineupUrl);
    assert.equal(candidate.lineup, undefined);
    assert.deepEqual(evaluateCandidate(current, candidate).changes, []);
    assert.ok(candidate.warnings.length);
  }
  assert.deepEqual(extract(lineup(), lineupUrl, { editionYear: 2028 }).evidence, []);
  assert.deepEqual(extract(lineup(), "https://www.jeraonair.nl/en/info/history/").evidence, []);
  assert.deepEqual(extract(lineup(), "https://attacker.example/en/line-up/").evidence, []);
});

test("consistent 2027 date moves produce review-required date changes", () => {
  const moved = info.replace("June 24-25-26", "July 29-30-31").replace("24, 25&nbsp;and 26 June", "29, 30&nbsp;and 31 July");
  const candidate = extract(moved, infoUrl);
  assert.equal(candidate.startDate, "2027-07-29");
  assert.equal(candidate.endDate, "2027-07-31");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate"]);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.deepEqual(result.changes.map(({ kind, reviewRequired }) => [kind, reviewRequired]), [["date_changed", true], ["date_changed", true]]);
  assert.match(result.reviewReasons.join("; "), /date_changed requires review/);
  const wrongEdition = evaluateCandidate({ ...current, editionYear: 2028 }, candidate);
  assert.equal(wrongEdition.publishable, false);
  assert.match(wrongEdition.reviewReasons.join("; "), /does not match catalogue edition 2028/);
});

test("title/body disagreements and invalid date triples fail closed", () => {
  const bad = [
    info.replace("June 24-25-26", "June 25-26-27"),
    info.replace("24, 25&nbsp;and 26 June", "25, 26&nbsp;and 27 June"),
    info.replace("June 24-25-26", "July 24-25-26"),
    info.replace("June 24-25-26", "June 29-30-31").replace("24, 25&nbsp;and 26 June", "29, 30&nbsp;and 31 June"),
    info.replace("June 24-25-26", "February 28-29-30").replace("24, 25&nbsp;and 26 June", "28, 29&nbsp;and 30 February"),
    info.replace("June 24-25-26", "June 24-26-27").replace("24, 25&nbsp;and 26 June", "24, 26&nbsp;and 27 June"),
  ];
  for (const html of bad) {
    const candidate = extract(html, infoUrl);
    assert.deepEqual(candidate.evidence, []);
    assert.deepEqual(evaluateCandidate(current, candidate).changes, []);
  }
});

test("date prose and edition drift fail closed despite matching site title", () => {
  for (const html of [info.replace("2027&nbsp;is edition", "2026&nbsp;is edition"), info.replace("24, 25&nbsp;and 26 June", "24, 25&nbsp;and 27 June"), info.replace("<h2>GENERAL</h2>", "<h2>HISTORY</h2>"), info.replace("Information - Jera On Air 2027", "Information - Jera On Air 2026")]) {
    assert.deepEqual(extract(html, infoUrl).evidence, []);
  }
});
