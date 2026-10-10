import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { validateSource } from "../lib/sources/repository.ts";
const source = { festivalSlug: "rock-werchter", url: "https://www.rockwerchter.be/", editionYear: 2027, strategies: ["official_markup"], refreshPolicy: "daily", enabled: true };
const now = "2026-10-10T13:01:00Z";
const fixture = name => readFileSync(new URL(`./fixtures/rock-werchter/${name}.html`, import.meta.url), "utf8");
const extract = (html, date = now, options = source) => extractFestivalCandidate(html, options, date);
for (const name of ["home", "home-en"]) test(`real ${name} correction: dates, exact billing, partial and future sale`, () => {
  const candidate = extract(fixture(name));
  assert.equal(validateSource(source), "official_markup:rock-werchter");
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.endDate, "2027-07-04");
  assert.deepEqual(candidate.headliners, ["Tame Impala"]);
  assert.deepEqual(candidate.lineup, ["SOMBR"]);
  assert.equal(candidate.status, "partial");
  assert.equal(candidate.ticketStatus, "unavailable");
  assert.equal(candidate.ticketsUrl, undefined);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.warnings, []);
});
test("existing production generic source consumes the verified fallback without config changes", () => {
  const candidate = extract(fixture("home-en"), now, { ...source, strategies: ["json_ld_event", "html_fallback"] });
  assert.deepEqual(candidate.lineup, ["SOMBR"]);
  assert.deepEqual(candidate.headliners, ["Tame Impala"]);
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.ticketStatus, "unavailable");
  assert.equal(candidate.ticketsUrl, undefined);
  assert.deepEqual(candidate.warnings, []);
});
test("later official names are not hardcoded and rotating cards never remove verified artists", () => {
  const html = fixture("home-en").replaceAll("SOMBR", "New Artist").replaceAll("Tame Impala", "Next Headliner");
  const candidate = extract(html);
  assert.deepEqual(candidate.lineup, ["New Artist"]);
  assert.deepEqual(candidate.headliners, ["Next Headliner"]);
  const current = { slug: source.festivalSlug, editionYear: 2027, startDate: "2027-07-01", endDate: "2027-07-04", status: "partial", ticketStatus: "unavailable", headliners: ["Tame Impala"], lineup: ["SOMBR", "Earlier Artist"] };
  const result = evaluateCandidate(current, candidate);
  assert.deepEqual(result.changes.map(c => c.kind), ["headliner_added", "artist_added"]);
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reviewReasons, []);
});
test("archived edition, foreign links and non-announcement titles cannot supply artists", () => {
  const html = fixture("home-en");
  assert.deepEqual(extract(html.replaceAll("2027", "2026")).evidence, []);
  assert.equal(extract(html.replaceAll("https://www.rockwerchter.be/en/news/", "https://evil.example/en/news/")).lineup, undefined);
  assert.equal(extract(html.replaceAll("SOMBR is coming to", "The countdown to")).lineup, undefined);
});
test("sale day and stale sales schedule do not establish availability", () => {
  assert.equal(extract(fixture("home-en"), "2026-10-30T00:00:00Z").ticketStatus, undefined);
  assert.equal(extract(fixture("home-en"), "2026-11-02T12:00:00Z").ticketStatus, undefined);
});
test("a later edition/date/sale can be parsed without a document hash or fixed bill", () => {
  const html = fixture("home-en").replaceAll("2027", "2028").replaceAll("1 July", "6 July").replaceAll("4 July", "9 July").replaceAll("30 October", "29 October");
  const c = extract(html, "2027-10-10T12:00:00Z", { ...source, editionYear: 2028 });
  assert.equal(c.startDate, "2028-07-06");
  assert.equal(c.endDate, "2028-07-09");
  assert.equal(c.ticketStatus, "unavailable");
});
test("corrected production facts are unchanged and cannot enqueue a publication", () => {
  const current = { slug: source.festivalSlug, editionYear: 2027, startDate: "2027-07-01", endDate: "2027-07-04", status: "partial", ticketStatus: "unavailable", headliners: ["Tame Impala"], lineup: ["SOMBR"] };
  const result = evaluateCandidate(current, extract(fixture("home")));
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.reviewReasons, []);
  assert.equal(result.publishable, false);
});
test("default full-inventory candidates still require confirmation for removals", () => {
  const current = { slug: source.festivalSlug, editionYear: 2027, status: "partial", headliners: ["Tame Impala"], lineup: ["SOMBR", "Earlier Artist"] };
  const c = extract(fixture("home-en"));
  delete c.artistListMode;
  const result = evaluateCandidate(current, c);
  assert.equal(result.publishable, false);
  assert.ok(result.changes.some(c => c.kind === "artist_removed" && c.reviewRequired));
});

test("legacy generic source still reviews genuinely unsupported documents", () => {
  const c = extract("<html>No announcements available</html>", now, { ...source, strategies: ["json_ld_event", "html_fallback"] });
  assert.deepEqual(c.evidence, []);
  assert.ok(c.warnings.includes("No JSON-LD Event was found"));
});
