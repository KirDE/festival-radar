import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parserSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { discoverTuskaAnnouncement, tuskaTicketsUrl, TUSKA_DOCUMENTS } from "../lib/ingestion/adapters/tuska.ts";

const observedAt = "2026-10-29T08:17:00.000Z";
const fixture = name => readFile(new URL(`./fixtures/official-markup/tuska-${name}-20261029.html`, import.meta.url), "utf8");
const source = lang => parserSource("tuska", {url: `https://tuska.fi/${lang === "en" ? "en/" : ""}`});
const envelope = (home, html) => JSON.stringify({kind: TUSKA_DOCUMENTS, home, article: {url: discoverTuskaAnnouncement(home, 2027), html}});
const current = {slug: "tuska", editionYear: 2027, startDate: "2027-07-02", endDate: "2027-07-04", status: "partial", headliners: ["Lorna Shore", "Children of Bodom"], lineup: ["Heaven Shall Burn", "Kanonenfieber", "Fox Lake", "Gaerea", "Avralize", "Sinizter", "Previously Reviewed Act"]};
const expected = ["Heaven Shall Burn", "Stratovarius", "Smash Into Pieces", "Guilt Trip", "Gaerea", "Fox Lake", "Conan", "The Baboon Show", "Sinizter", "I Prevail", "Turmion Kätilöt", "Danko Jones", "Kanonenfieber", "Speed", "Tukkanuotta", "Atlas", "Celestial Sanctuary", "Green Lung", "Avralize", "Split Dogs", "Orbit Culture", "The Devil Wears Prada", "Paradise Lost", "Fit For A King", "Cenobia", "SUN"];

for (const lang of ["fi", "en"]) {
  test(`Tuska ${lang}: actual news cards discover and parse the current 29-act daily bill`, async () => {
    const home = await fixture(`home-${lang}`), article = await fixture(`news-${lang}`), tickets = await fixture(`tickets-${lang}`);
    const calls = [];
    const result = await fetchSource(source(lang), {maxAttempts: 1, fetchImpl: async (url, options) => {
      calls.push([url, options.redirect]);
      return new Response(calls.length === 1 ? home : calls.length === 2 ? article : tickets);
    }});
    const candidate = extractFestivalCandidate(await result.response.text(), source(lang), observedAt);
    assert.equal(result.attempts, 3);
    assert.deepEqual(calls, [[source(lang).url, "follow"], [discoverTuskaAnnouncement(home, 2027), "error"], [tuskaTicketsUrl(home, source(lang)), "error"]]);
    assert.deepEqual(candidate.headliners, ["Children Of Bodom", "Judas Priest", "Lorna Shore"]);
    assert.deepEqual(candidate.lineup, expected);
    assert.deepEqual(candidate.warnings, []);
    assert.equal(candidate.ticketStatus, "available");
    assert.equal(candidate.ticketsUrl, calls[2][0]);
    assert.ok(candidate.evidence.filter(e => ["ticketStatus", "ticketsUrl"].includes(e.field)).every(e => e.sourceUrl === calls[2][0]));
    assert.deepEqual(candidate.observedEditionYears, [2027]);
    assert.equal(candidate.artistListMode, "additive");
    assert.equal(candidate.lineupScope, "announcement");
    for (const evidence of candidate.evidence.filter(e => ["lineup", "headliners"].includes(e.field))) assert.equal(evidence.sourceUrl, calls[1][0]);
    const evaluation = evaluateCandidate(current, candidate);
    assert.equal(evaluation.publishable, true);
    assert.deepEqual(evaluation.reviewReasons, []);
    assert.equal(evaluation.changes.filter(c => ["artist_added", "headliner_added"].includes(c.kind)).length, 21);
    assert.ok(!evaluation.changes.some(c => c.kind.endsWith("_removed")));
    assert.ok(!JSON.stringify(candidate).includes("SLOMOSA"));
  });
}

test("Tuska discovery ignores scripts, footer, concerts, foreign origins and other editions", async () => {
  const home = await fixture("home-fi");
  for (const html of [`<script>${home}</script>`, `<footer>${home}</footer>`, home.replaceAll("https://tuska.fi/", "https://evil.test/"), home.replaceAll("tuska-2027-", "tuska-2026-"), home.replaceAll("tuska-2027-", "slomosa-2027-")]) {
    assert.equal(discoverTuskaAnnouncement(html, 2027), undefined);
  }
});

for (const [label, mutate] of [
  ["wrong article year", html => html.replaceAll("2027", "2026")],
  ["missing main", html => html.replaceAll("main", "aside")],
  ["wrong canonical", html => html.replace('href="https://tuska.fi/', 'href="https://evil.test/')],
  ["missing bill heading", html => html.replace("Vahvistuneet Tuska 2027 -esiintyjät esiintymispäivittäin:", "Other news")],
  ["wrong day", html => html.replace("Lauantai 3.7.2027", "Lauantai 4.7.2027")],
  ["wrong weekday", html => html.replace("Perjantai 2.7.2027", "Sunnuntai 2.7.2027")],
  ["missing boundary", html => html.replace("Tarkat soittoaikataulut", "Something different")],
  ["duplicate artist", html => html.replace("Fit For A King, Cenobia, SUN", "Fit For A King, Cenobia, Lorna Shore")],
  ["ambiguous top billing", html => html.replace("Children Of Bodom <br>", "Children Of Bodom, Judas Priest <br>")],
]) test(`Tuska fails closed on ${label}`, async () => {
  const candidate = extractFestivalCandidate(envelope(await fixture("home-fi"), mutate(await fixture("news-fi"))), source("fi"), observedAt);
  assert.equal(candidate.lineup, undefined);
  assert.equal(candidate.headliners, undefined);
  assert.ok(candidate.warnings.length);
  assert.equal(evaluateCandidate(current, candidate).publishable, false);
});

test("Tuska linked HTTP failures stay failures; redirected documents are refused", async () => {
  const home = await fixture("home-fi");
  for (const status of [403, 404, 500]) {
    let n = 0;
    const result = await fetchSource(source("fi"), {maxAttempts: 1, fetchImpl: async () => ++n === 1 ? new Response(home) : new Response("unavailable", {status})});
    assert.equal(result.response.status, status);
    assert.equal(result.attempts, 2);
  }
  let n = 0;
  await assert.rejects(fetchSource(source("fi"), {maxAttempts: 1, fetchImpl: async () => {
    const response = new Response(++n === 1 ? home : await fixture("news-fi"));
    Object.defineProperty(response, "url", {value: n === 1 ? source("fi").url : "https://evil.test/"});
    return response;
  }}), /official identity/);
});

for (const [label, mutate] of [
  ["past-edition sales", html => html.replaceAll("2027", "2026")],
  ["future sales", html => html.replace("are now on sale!", "will go on sale tomorrow!")],
  ["sold-out weekend", html => html.replace('class="ticket-info__ticket"', 'class="ticket-info__ticket sold-out"').replace("€259", "SOLD OUT")],
  ["disabled purchase link", html => html.replaceAll('class="ticket-info__ticket-link"', 'class="ticket-info__ticket-link" aria-disabled="true"')],
  ["foreign vendor", html => html.replaceAll("https://www.tiketti.fi/", "https://evil.test/")],
  ["wrong canonical", html => html.replace('rel="canonical" href="https://tuska.fi/', 'rel="canonical" href="https://evil.test/')],
]) test(`Tuska ticket status is not inferred from ${label}`, async () => {
  const home = await fixture("home-en");
  const body = JSON.stringify({kind: TUSKA_DOCUMENTS, home, tickets: {url: tuskaTicketsUrl(home, source("en")), html: mutate(await fixture("tickets-en"))}});
  const candidate = extractFestivalCandidate(body, source("en"), observedAt);
  assert.equal(candidate.ticketStatus, undefined);
  assert.ok(candidate.warnings.length);
});

test("Tuska current sold-out declaration overrides stale buy links", async () => {
  const home = await fixture("home-en");
  const html = (await fixture("tickets-en")).replace("All tickets for Tuska 2027 are now on sale!", "Tuska 2027 is sold out!");
  const candidate = extractFestivalCandidate(JSON.stringify({kind: TUSKA_DOCUMENTS, home, tickets: {url: tuskaTicketsUrl(home, source("en")), html}}), source("en"), observedAt);
  assert.equal(candidate.ticketStatus, "unavailable");
  assert.deepEqual(candidate.warnings, []);
});

test("Tuska preserves legacy date-only pages and does not follow explicit source overrides", async () => {
  const legacy = "<title>Tuska Festival - 02.–04.7.2027</title>";
  const candidate = extractFestivalCandidate(legacy, source("fi"), observedAt);
  assert.equal(candidate.startDate, "2027-07-02");
  assert.equal(candidate.lineup, undefined);
  assert.deepEqual(candidate.warnings, []);
  for (const overrides of [{url: "https://source.example.test/"}, {fetchUrl: "https://tuska.fi/"}]) {
    let calls = 0;
    await fetchSource({...source("fi"), ...overrides}, {maxAttempts: 1, fetchImpl: async () => {calls++; return new Response(await fixture("home-fi"));}});
    assert.equal(calls, 1);
  }
});
