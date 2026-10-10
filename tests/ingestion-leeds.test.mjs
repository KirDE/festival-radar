import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { extractLeedsCandidate } from "../lib/ingestion/adapters/leeds.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const fixture = readFileSync(new URL("./fixtures/leeds-tickets-2027.html", import.meta.url), "utf8");
const source = { festivalSlug: "leeds", url: "https://www.leedsfestival.com/", strategies: ["json_ld_event", "html_fallback"], enabled: true, editionYear: 2027, refreshPolicy: "every_3_days" };
const at = "2026-10-10T13:17:00Z";
const parse = (html = fixture, s = source) => extractFestivalCandidate(html, s, at);

test("actual Leeds correction: current advertised span and live weekend product reproduce API correction", () => {
  const candidate = parse();
  assert.equal(candidate.startDate, "2027-08-26"); assert.equal(candidate.endDate, "2027-08-29");
  assert.equal(candidate.ticketStatus, "available"); assert.equal(candidate.ticketsUrl, "https://www.leedsfestival.com/tickets");
  assert.deepEqual(candidate.observedEditionYears, [2027]); assert.deepEqual(candidate.warnings, []);
  assert.equal(candidate.lineup, undefined); assert.equal(candidate.headliners, undefined); assert.equal(candidate.status, undefined);
  assert.equal(candidate.evidence.find((e) => e.field === "ticketStatus").sourceUrl, "https://www.leedsfestival.com/tickets");
  const current = { slug: "leeds", editionYear: 2027, startDate: "2027-08-26", endDate: "2027-08-29", ticketsUrl: candidate.ticketsUrl, ticketStatus: "available", status: "tba", lineup: [], headliners: [] };
  assert.deepEqual(evaluateCandidate(current, candidate).changes, []); assert.deepEqual(evaluateCandidate(current, candidate).reviewReasons, []);
});

test("later official edition, prices and release numbers need no hardcoded bill or content hash", () => {
  const candidate = parse(fixture.replaceAll("2027", "2028").replaceAll("1st Release", "3rd release").replaceAll("£326", "£341"), { ...source, editionYear: 2028 });
  assert.equal(candidate.startDate, "2028-08-26"); assert.equal(candidate.ticketStatus, "available"); assert.deepEqual(candidate.observedEditionYears, [2028]);
});

test("old product descriptions under a current hero cannot establish ticket availability", () => {
  const candidate = parse(fixture.replaceAll("August 2027", "August 2026"));
  assert.equal(candidate.startDate, "2027-08-26"); assert.equal(candidate.ticketStatus, undefined);
});

test("homepage sales CTA and archive news do not invent live inventory or current artists", () => {
  const candidate = parse('<div class="action-bar_cta"><div>26-29 Aug 2027</div></div><a href="/tickets">Secure your ticket for £20</a><article class="lineup">2026: Old Band</article>');
  assert.equal(candidate.ticketStatus, undefined); assert.equal(candidate.lineup, undefined); assert.deepEqual(candidate.warnings, []);
});

test("sold-out weekend products, not stale Buy controls, establish unavailability", () => {
  const candidate = parse(fixture.replaceAll("1st Release", "Sold Out"));
  assert.equal(candidate.ticketStatus, "unavailable");
});

test("sold-out accessory or early-entry package does not override available regular passes", () => {
  const candidate = parse(fixture.replace("1st Release", "Sold Out")); assert.equal(candidate.ticketStatus, "available");
});

test("hidden, disabled, untrusted or absent Buy controls cannot establish availability", () => {
  for (const fixtureChange of [
    fixture.replaceAll('class="button is-small is-tickets w-inline-block"', 'class="button hide is-small is-tickets w-inline-block"'),
    fixture.replaceAll('href="https://www.ticketmaster', 'aria-disabled="true" href="https://www.ticketmaster'),
    fixture.replaceAll("www.ticketmaster.co.uk", "untrusted.example"),
    fixture.replaceAll(">Buy<", ">Coming Soon<"),
  ]) assert.equal(parse(fixtureChange).ticketStatus, undefined);
});

test("hidden/commented previous-edition banner does not poison current dates", () => {
  const old = '<div class="action-bar_cta"><div>27-30 Aug 2026</div></div>';
  assert.equal(parse(`<!--${old}--><div hidden>${old}</div>${fixture}`).startDate, "2027-08-26");
});

test("invalid, conflicting, or missing visible date ranges fail closed", () => {
  for (const html of [fixture.replaceAll("26-29 Aug", "30-32 Aug"), fixture.replaceAll("26-29 Aug", "29-26 Aug"), fixture.replaceAll("26-29 Aug", "26-29 Feb"), fixture.replaceAll("26-29 Aug 2027", "TBA"), fixture + '<div class="action-bar_cta"><div>27-30 Aug 2026</div></div>']) assert.equal(extractLeedsCandidate(html, source, at), undefined);
});

test("adapter is pinned to real official festival origin and supported page routes", () => {
  for (const url of ["https://untrusted.example/", "https://www.leedsfestival.com/news/old", "https://www.leedsfestival.com/?archive=2026"]) assert.equal(extractLeedsCandidate(fixture, { ...source, url }, at), undefined);
});

test("fetchSource follows only the actual same-origin Leeds ticket link", async () => {
  const urls = [];
  const result = await fetchSource(source, { fetchImpl: async (url) => { urls.push(url); return new Response(urls.length === 1 ? '<a href="https://evil.example/tickets">Bad</a><a href="/tickets">Tickets</a>' : fixture); } });
  assert.deepEqual(urls, [source.url, "https://www.leedsfestival.com/tickets"]); assert.equal(result.attempts, 2); assert.equal(parse(await result.response.text()).ticketStatus, "available");
});

test("failed ticket HTTP preserves a real source failure, not invented success", async () => {
  let calls = 0;
  const result = await fetchSource(source, { maxAttempts: 1, fetchImpl: async () => new Response(++calls === 1 ? '<a href="/tickets">Tickets</a>' : "blocked", { status: calls === 1 ? 200 : 403 }) });
  assert.equal(result.response.status, 403); assert.equal(result.attempts, 2);
});

test("no trusted link leaves homepage readable, not an unverified external follow", async () => {
  let calls = 0;
  const html = '<div class="action-bar_cta"><div>26-29 Aug 2027</div></div><a href="https://evil.example/tickets">Tickets</a>';
  const result = await fetchSource(source, { fetchImpl: async () => { calls++; return new Response(html); } });
  assert.equal(calls, 1); assert.equal(parse(await result.response.text()).ticketStatus, undefined);
});

test("explicit source fetch/follow configurations are not overridden", async () => {
  for (const s of [{ ...source, fetchUrl: "https://www.leedsfestival.com/tickets" }, { ...source, url: "https://www.leedsfestival.com/tickets" }]) {
    let calls = 0;
    const result = await fetchSource(s, { fetchImpl: async () => { calls++; return new Response(fixture); } });
    assert.equal(calls, 1); assert.equal(parse(await result.response.text(), s).ticketStatus, "available");
  }
});


test("later official month and date span follows live product descriptions", () => {
  const candidate = parse(fixture.replaceAll("26-29 Aug 2027", "25-28 Jul 2028").replaceAll("August 2027", "July 2028"));
  assert.equal(candidate.startDate, "2028-07-25"); assert.equal(candidate.endDate, "2028-07-28"); assert.equal(candidate.ticketStatus, "available");
});

test("off-origin homepage or ticket redirects fail rather than parsing unrelated content", async () => {
  for (const phase of [1, 2]) {
    let calls = 0;
    await assert.rejects(fetchSource(source, { fetchImpl: async () => {
      const response = new Response(++calls === 1 ? '<a href="/tickets">Tickets</a>' : fixture);
      Object.defineProperty(response, "url", { value: calls === phase ? "https://evil.example/tickets" : calls === 1 ? source.url : "https://www.leedsfestival.com/tickets" });
      return response;
    } }), /redirected away/);
  }
});
