import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parserSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { sourceParserKey } from "../lib/sources/repository.ts";

const url = "https://copenhell.dk/faith-no-more-headline-copenhell-2027/";
const at = "2026-10-06T19:37:00Z";
const fixture = (name) => readFile(new URL("./fixtures/official-markup/copenhell-" + name + "-2027.html", import.meta.url), "utf8");
const source = (overrides = {}) => parserSource("copenhell", { url, ...overrides });
const extract = (html, overrides) => extractFestivalCandidate(html, source(overrides), at);
const current = { slug: "copenhell", name: "Copenhell", editionYear: 2027, startDate: null, endDate: null, country: "DK", officialUrl: url, status: "partial", headliners: [], lineup: [] };

test("only the dated Danish official article yields exact 2027 dates and two explicitly named headliners", async () => {
  assert.equal(sourceParserKey(source()), "official_markup:copenhell");
  const candidate = extract(await fixture("announcement"));
  assert.equal(candidate.startDate, "2027-06-23");
  assert.equal(candidate.endDate, "2027-06-26");
  assert.deepEqual(candidate.headliners, ["Faith No More", "Judas Priest"]);
  assert.equal(candidate.lineup, undefined);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "headliners"]);
  assert.ok(candidate.evidence.every(({ sourceUrl }) => sourceUrl === url));
  assert.match(candidate.evidence[0].excerpt, /06.10.2026.*23.-26. juni 2027/);
  assert.match(candidate.warnings.join('; '), /Agent review required before lineup-triggered provider activity/);
  assert.equal(evaluateCandidate(current, candidate).publishable, false); // no automatic playlist create
});

test("undated homepage and programme never extract a full lineup, even with a synthetic year heading and 29 cards", async () => {
  for (const [name, path] of [["home", "https://copenhell.dk/"], ["program", "https://copenhell.dk/program/"]]) {
    const candidate = extract(await fixture(name), { url: path });
    assert.deepEqual(candidate.evidence, []);
    assert.deepEqual(candidate.observedEditionYears, []);
    assert.equal(candidate.lineup, undefined);
    assert.match(candidate.warnings.join("; "), /requires the dated official announcement URL/);
    assert.deepEqual(evaluateCandidate({ ...current, lineup: ["Faith No More"] }, candidate).changes, []);
  }
  for (const path of [url + "?old=2026", "https://copenhell.dk/en/faith-no-more-will-headline-copenhell-2027/", "https://evil.example/faith-no-more-headline-copenhell-2027/"]) {
    assert.deepEqual(extract(await fixture("announcement"), { url: path }).evidence, []);
  }
});

test("Danish article teaser and programme spelling/count drift cannot become lineup", async () => {
  const article = await fixture("announcement");
  const variant = article.replace("</h2>", "</h2><p>FAITH NO MORE, JUDAS PRIEST, HAYWIRE, BLOOD STAIN and 25 other names.</p>");
  const candidate = extract(variant);
  assert.deepEqual(candidate.headliners, ["Faith No More", "Judas Priest"]);
  assert.equal(candidate.lineup, undefined);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "headliners"]);
});

test("wrong year, dates, headliner prose, or publication timestamp fail closed", async () => {
  const article = await fixture("announcement");
  const wrong = [
    article.replace("23.-26. juni 2027", "23.-26. juni 2026"),
    article.replace("COPENHELL 2027 finder sted", "COPENHELL 2026 finder sted"),
    article.replace("2026-10-06T", "2026-06-10T"),
    article.replace("06.10.2026", "10.06.2026"), // English display is not the festival date
    article.replace("bliver næste års hovednavne", "var sidste års hovednavne"),
    article.replace("23.-26. juni", "23.-27. juni"),
    article.replace("23.-26. juni 2027.", "23.-26. juni 2027, eller 24.-27. juni 2027."),
    article.replace("23.-26. juni", "29.-32. juni"),
    article.replace("<h2>", "<h3>").replace("</h2>", "</h3>"),
  ];
  for (const html of wrong) {
    const candidate = extract(html);
    assert.deepEqual(candidate.evidence, []);
    assert.deepEqual(evaluateCandidate(current, candidate).changes, []);
    assert.ok(candidate.warnings.length);
  }
  const wrongSourceYear = extract(article, { editionYear: 2028 });
  assert.deepEqual(wrongSourceYear.evidence, []);
  assert.match(wrongSourceYear.warnings.join("; "), /configured source year/);
});
