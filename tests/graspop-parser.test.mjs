import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { extractHtmlFallbackCandidate } from "../lib/ingestion/adapters/html-fallback.ts";
import { parserSource } from "./support/parser-source.ts";
import { validateSource } from "../lib/sources/repository.ts";

const source = parserSource("graspop", { url: "https://www.graspop.be/en/info/festival-essentials" });
const observed = "2026-10-10T12:23:00.000Z";
const fixture = await readFile(new URL("./fixtures/official-markup/graspop-essentials.html", import.meta.url), "utf8");
const parse = (html, overrides = {}) => extractFestivalCandidate(html, { ...source, ...overrides }, observed);

test("real corrected Graspop FAQ yields dates, not stale template, tickets or bill", () => {
  assert.equal(validateSource(source), "official_markup:graspop");
  const candidate = parse(fixture);
  assert.equal(candidate.startDate, "2027-06-17");
  assert.equal(candidate.endDate, "2027-06-20");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(e => e.field), ["startDate", "endDate"]);
  assert.ok(candidate.evidence.every(e => e.sourceUrl === source.url && e.excerpt.includes("2027 takes place from 17 through 20 June")));
  for (const key of ["lineup", "headliners", "status", "ticketStatus", "ticketsUrl"]) assert.equal(candidate[key], undefined);
});

test("later official dates are supported without hardcoded year, month, or document hash", () => {
  const updated = fixture.replace("2027 takes place from 17 through 20 June", "2028 takes place from <strong>22</strong> to 25 July");
  const candidate = parse(updated, { editionYear: 2028 });
  assert.equal(candidate.startDate, "2028-07-22");
  assert.equal(candidate.endDate, "2028-07-25");
  assert.equal(parse(updated).startDate, undefined);
});

test("archive, footer, invalid and conflicting ranges do not propose dates", () => {
  assert.equal(parse(fixture.replace("2027 takes place", "2026 takes place")).startDate, undefined);
  assert.equal(parse(fixture.replace("<main>", "<footer>").replace("</main>", "</footer>")).startDate, undefined);
  for (const replacement of ["2027 takes place from 31 through 32 June", "2027 takes place from 20 through 17 June"]) {
    assert.equal(parse(fixture.replace("2027 takes place from 17 through 20 June", replacement)).startDate, undefined);
  }
  const conflict = fixture.replace("</main>", "<p>Graspop Metal Meeting 2027 takes place from 24 through 27 June</p></main>");
  assert.equal(parse(conflict).startDate, undefined);
});

test("the actual GMM26 train/car park ticket candidate is rejected, festival sales remain supported", () => {
  const generic = { ...source, strategies: ["html_fallback"] };
  assert.equal(extractHtmlFallbackCandidate(fixture, generic, observed).ticketsUrl, undefined);
  for (const label of ["Train tickets", "Car park tickets now on sale!"]) {
    assert.equal(extractHtmlFallbackCandidate(`<a href="/en/travel">${label}</a>`, generic, observed).ticketsUrl, undefined);
  }
  assert.equal(extractHtmlFallbackCandidate('<a href="/en/tickets">Festival tickets</a>', generic, observed).ticketsUrl, "https://www.graspop.be/en/tickets");
});
