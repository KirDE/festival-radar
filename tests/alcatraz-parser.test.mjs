import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const fixture = await readFile(new URL("./fixtures/official-markup/alcatraz-current-banner.html", import.meta.url), "utf8");
const source = { festivalSlug: "alcatraz", url: "https://www.alcatraz.be/", editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"], refreshPolicy: "every_3_days", enabled: true };
const parse = (html = fixture, overrides = {}) => extractFestivalCandidate(html, { ...source, ...overrides }, "2026-10-10T13:50:00Z");

test("real Alcatraz correction: current dates and official tickets, not AOA26 bill or stock", () => {
  const candidate = parse();
  assert.equal(candidate.startDate, "2027-08-05");
  assert.equal(candidate.endDate, "2027-08-08");
  assert.equal(candidate.ticketsUrl, "https://www.alcatraz.be/en/tickets");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(e => e.field), ["startDate", "endDate", "ticketsUrl"]);
  assert.ok(candidate.evidence.every(e => e.sourceUrl === source.url && e.excerpt.includes("August 5.6.7.8 2027")));
  for (const key of ["lineup", "headliners", "status", "ticketStatus", "city"]) assert.equal(candidate[key], undefined);
});

test("later official dates and editions work without fixed facts or a document hash", () => {
  const html = fixture.replaceAll("2027", "2028").replace("August 5.6.7.8 2028", "July <b>12</b>.13.14 2028");
  const result = parse(html, { editionYear: 2028 });
  assert.equal(result.startDate, "2028-07-12");
  assert.equal(result.endDate, "2028-07-14");
  assert.deepEqual(result.warnings, []);
  assert.equal(parse(html).startDate, undefined);
});

test("missing, archived, conflicting or invalid banner evidence never proposes dates/tickets", () => {
  for (const html of [fixture.replace("top-banner", "archive-banner"), fixture.replace("August 5.6.7.8 2027", "August 5.6.7.8 2026"),
      fixture.replace("5.6.7.8 2027", "5.7.8 2027"), fixture.replace("August 5.6.7.8 2027", "February 29.30.31 2027"),
      fixture.replace("</section>", '<span class="navbar-text">August 12.13.14 2027 | Kortrijk - BE</span></section>')]) {
    const candidate = parse(html);
    assert.equal(candidate.startDate, undefined);
    assert.equal(candidate.ticketsUrl, undefined);
    assert.ok(candidate.warnings.length > 0);
  }
  assert.equal(parse(fixture, { url: "https://archive.example.test/" }).startDate, undefined);
  assert.equal(parse(fixture, { url: "https://www.alcatraz.be/en/history" }).startDate, undefined);
});

test("ignore stale JSON-LD, scripts/comments and untrusted or non-navigation ticket offers", () => {
  const event = '<script type="application/ld+json">{"@type":"Event","startDate":"2026-08-06","endDate":"2026-08-09","performer":{"@type":"MusicGroup","name":"Archived Band"}}</script>';
  const result = parse(event + '<!--<section class="top-banner"><span class="navbar-text">August 1.2 2026 | Kortrijk - BE</span></section>-->' + fixture);
  assert.equal(result.startDate, "2027-08-05");
  assert.equal(result.lineup, undefined);
  assert.deepEqual(result.warnings, []);
  for (const href of ["https://evil.example/en/tickets", "/en/tickets?year=2026", "/en/merchandise", "/en/2026/tickets"]) {
    assert.equal(parse(fixture.replace('href="/en/tickets"', 'href="' + href + '"')).ticketsUrl, undefined);
  }
  assert.equal(parse(fixture.replace("navbar-primary", "footer-nav")).ticketsUrl, undefined);
});

test("corrected catalogue stays unchanged with verified partial artists preserved", () => {
  const current = { slug: "alcatraz", name: "Alcatraz Open Air", editionYear: 2027, city: "Kortrijk", country: "Belgium",
    startDate: "2027-08-05", endDate: "2027-08-08", headliners: ["Verified Headliner"], lineup: ["Verified Band"],
    status: "partial", ticketStatus: "unknown", ticketsUrl: "https://www.alcatraz.be/en/tickets" };
  const result = evaluateCandidate(current, parse());
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.reviewReasons, []);
});
