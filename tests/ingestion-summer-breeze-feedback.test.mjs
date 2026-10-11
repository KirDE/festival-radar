import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const fixture = readFileSync(new URL("./fixtures/summer-breeze-2027-feedback.html", import.meta.url), "utf8");
const source = { festivalSlug: "summer-breeze", url: "https://www.summer-breeze.de/", editionYear: 2027,
  strategies: ["json_ld_event", "html_fallback"], refreshPolicy: "daily", enabled: true };
const parse = (html = fixture, overrides = {}) => extractFestivalCandidate(html, { ...source, ...overrides }, "2026-10-10T13:32:00Z");
const sales = title => `<h3 class="swiper-slide__headline">${title}</h3>`;
const noSelloutHighlight = fixture.replace(/<h3 class="swiper-slide__headline">[\s\S]*?<\/h3>/g, "");

test("real corrected homepage does not replace verified artists with the Alle filter", () => {
  const c = parse();
  assert.equal(c.lineup, undefined);
  assert.equal(c.headliners, undefined);
  assert.equal(c.startDate, "2027-08-18");
  assert.equal(c.endDate, "2027-08-21");
  assert.equal(c.status, "partial");
  assert.equal(c.ticketStatus, "unavailable");
  assert.equal(c.ticketsUrl, "https://www.summer-breeze.de/de/tickets/");
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  assert.ok(c.evidence.find(e => e.field === "ticketStatus").excerpt.includes("AUSVERKAUFT"));
});

test("the corrected facts produce no destructive catalog or provider-triggering changes", () => {
  const current = { slug: "summer-breeze", name: "Summer Breeze", country: "Germany", countryCode: "DE",
    officialUrl: source.url, editionYear: 2027, startDate: "2027-08-18", endDate: "2027-08-21",
    headliners: ["Electric Callboy"], lineup: ["John Bush", "PeelingFlesh"], genres: [],
    status: "partial", ticketStatus: "unavailable", ticketsUrl: "https://www.summer-breeze.de/de/tickets/", updatedAt: "2026-10-10T09:00:00Z" };
  const r = evaluateCandidate(current, parse());
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.reviewReasons, []);
  assert.equal(r.publishable, false);
});

test("header year is mandatory even when the news and navigation look current", () => {
  const c = parse(fixture.replaceAll('datetime="2027-', 'datetime="2026-'));
  assert.deepEqual(c.evidence, []);
  assert.deepEqual(c.observedEditionYears, []);
  assert.match(c.warnings.join(" "), /edition-matched/);
});

test("old day bills and generic sales copy do not establish ticket availability", () => {
  const c = parse(noSelloutHighlight + '<h3>SUMMER BREEZE 2026 AUSVERKAUFT</h3><p>Tagestickets jetzt erhältlich. Sichere dir jetzt dein Ticket!</p><a href="https://www.sbtix.de/tickets">Tickets</a>');
  assert.equal(c.ticketStatus, undefined);
  assert.equal(c.ticketsUrl, "https://www.summer-breeze.de/de/tickets/");
});

test("a later current-edition day-ticket sale can supersede the removed sellout highlight", () => {
  const c = parse(noSelloutHighlight + sales("SUMMER BREEZE 2027 – Tagestickets jetzt erhältlich"));
  assert.equal(c.ticketStatus, "available");
});

test("conflicting prominent sales announcements abstain", () => {
  assert.equal(parse(fixture + sales("SUMMER BREEZE 2027 – Tagestickets jetzt verfügbar")).ticketStatus, undefined);
});

test("a newer complete-bill announcement supersedes the older first-band article", () => {
  const c = parse('<h3 class="teaser__title">SUMMER BREEZE 2027 – Das vollständige Line-Up</h3>' + fixture);
  assert.equal(c.status, "confirmed");
  assert.equal(c.lineup, undefined);
});

test("later edition, dates and news work without a pinned bill or document hash", () => {
  const c = parse(fixture.replaceAll("2027", "2028").replaceAll("08-18", "08-16").replaceAll("08-21", "08-19") + '<p>New official announcement and new artists</p>', { editionYear: 2028 });
  assert.equal(c.startDate, "2028-08-16");
  assert.equal(c.endDate, "2028-08-19");
  assert.equal(c.ticketStatus, "unavailable");
  assert.equal(c.status, "partial");
});

test("an external ticket-information impostor is not selected", () => {
  assert.equal(parse(fixture.replaceAll("https://www.summer-breeze.de/de/tickets/", "https://evil.test/de/tickets/")).ticketsUrl, undefined);
});


test("mixed-edition generic Event data cannot reintroduce a destructive lineup guess", () => {
  const c = parse(fixture + '<script type="application/ld+json">{"@type":"Event","name":"Summer Breeze 2026","startDate":"2026-08-12","performer":[{"@type":"MusicGroup","name":"Alle"}]}</script>');
  assert.equal(c.lineup, undefined);
  assert.equal(c.startDate, "2027-08-18");
  assert.deepEqual(c.warnings, []);
});
