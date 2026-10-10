import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { parserSource } from "./support/parser-source.ts";

const url = "https://dynamo-metalfest.nl/first-names-dmf-27/";
const lineupUrl = "https://dynamo-metalfest.nl/line-up/";
const at = "2026-10-10T15:52:00Z";
const source = (overrides = {}) => parserSource("dynamo-metal-fest", { url, ...overrides });
const fixture = await readFile(new URL("./fixtures/official-markup/dynamo-first-names-2027.html", import.meta.url), "utf8");
// Reduced title/canonical/H1/back-link/MusicEvent from actual official documents,
// including the misspelled Cavalera set title. No guessed artist or billing data.
const docs = JSON.parse(await readFile(new URL("./fixtures/official-markup/dynamo-current-discovery-2027.json", import.meta.url), "utf8"));
const bundle = (documents) => `<script type="application/json" id="festival-radar-dynamo-bands">${JSON.stringify(documents).replace(/</g, "\\u003c")}</script>`;
const extract = (html = fixture, documents = docs, overrides) => extractFestivalCandidate(html + bundle(documents), source(overrides), at);
const artists = ["Architects", "Mercyful Fate", "Cavalera", "Hypocrisy", "Madball", "I Am Morbid", "Corrosion of Conformity", "Sylosis", "Fulci", "Left to Suffer", "Elegy"];
const current = { slug: "dynamo-metal-fest", editionYear: 2027, city: "Eindhoven", startDate: "2027-08-13", endDate: "2027-08-15", status: "partial", headliners: [], lineup: artists, ticketStatus: "unknown" };
const copy = () => structuredClone(docs);
const noLineup = candidate => {
  assert.equal(candidate.lineup, undefined);
  assert.ok(candidate.warnings.length);
  assert.equal(evaluateCandidate(current, candidate).changes.some(c => c.kind === "artist_removed"), false);
};

test("real correction discovers Fulci/Elegy, strips set labels, preserves partial billing and unknown tickets", () => {
  const c = extract();
  assert.deepEqual(c.lineup, artists);
  assert.equal(c.headliners, undefined);
  assert.equal(c.ticketStatus, undefined);
  assert.equal(c.ticketsUrl, undefined);
  assert.equal(c.status, "partial");
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.equal(c.evidence.find(e => e.field === "lineup").sourceUrl, lineupUrl);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(evaluateCandidate(current, c).changes, []);
  assert.deepEqual(evaluateCandidate(current, c).reviewReasons, []);
});

test("first article alone cannot remove newer verified performers", () => {
  noLineup(extractFestivalCandidate(fixture, source(), at));
});

test("plausible later additions and changed first-announcement count are supported but require provider review", () => {
  const later = copy(), d = structuredClone(later[0]);
  d.url = d.canonical = d.event.url = "https://dynamo-metalfest.nl/bands/new-act/";
  d.title = d.title.replace("Architects", "New Act"); d.heading = d.event.performer.name = "New Act";
  later.push(d);
  for (const html of [fixture, fixture.replace("<br>LEFT TO SUFFER", "<br>LEFT TO SUFFER<br>NEW ACT")]) {
    const c = extract(html, later);
    assert.equal(c.lineup.at(-1), "New Act");
    const r = evaluateCandidate(current, c);
    assert.deepEqual(r.changes.map(x => x.kind), ["artist_added"]);
    assert.match(r.reviewReasons.join(";"), /provider activity/);
    assert.equal(r.publishable, false);
  }
});

test("archive, canonical, identity, cancellation, missing schema and wrong date evidence fail closed", () => {
  const mutations = [d => d.title = d.title.replace("2027", "2026"), d => d.canonical += "?archive=2026", d => d.url = "https://evil.example/bands/fulci/", d => d.editionLink = false, d => d.heading = "Tickets", d => d.event.performer.name = "Other Artist", d => d.event.startDate = "2026-08-14T21:30:00+02:00", d => d.event.endDate = "2027-08-16T23:00:00+02:00", d => d.event.endDate = "2027-08-13T00:00:00+02:00", d => d.event.eventStatus = "https://schema.org/EventCancelled", d => delete d.event];
  for (const mutate of mutations) { const ds = copy(); mutate(ds[8]); noLineup(extract(fixture, ds)); }
  noLineup(extract(fixture, []));
  noLineup(extract(fixture, [...docs, docs[0]]));
  noLineup(extract(fixture, docs.filter(d => d.heading !== "Architects")));
});

test("source/article identity and invalid announcement prose remain guarded", () => {
  for (const sourceUrl of ["https://dynamo-metalfest.nl/", "https://evil.example/first-names-dmf-27/", url + "?archive=2026"]) noLineup(extract(fixture, docs, { url: sourceUrl }));
  noLineup(extract(fixture, docs, { editionYear: 2026 }));
  for (const html of [fixture.replace('rel="canonical"', 'rel="alternate"'), fixture.replace('data-widget_type="theme-post-content.default"', 'data-widget_type="footer.default"'), fixture.replace("August 13, 14 &amp; 15, 2027", "August 13, 14 &amp; 16, 2027"), fixture.replace("CAVALERA – CHAOS A.D.", "CAVALERA – UNKNOWN SET"), fixture.replace("<br>LEFT TO SUFFER", "<br>ARCHITECTS")]) noLineup(extract(html));
});

test("later edition-bound date changes are extracted, never silently published", () => {
  const ds = copy();
  for (const d of ds) { d.title = d.title.replace("13, 14 & 15", "20, 21 & 22"); for (const f of ['startDate','endDate']) d.event[f] = d.event[f].replace(/2027-08-(\d+)/, (_, day) => '2027-08-' + (Number(day) + 7)); }
  const c = extract(fixture.replace("August 13, 14 &amp; 15, 2027", "August 20, 21 &amp; 22, 2027"), ds);
  assert.equal(c.startDate, '2027-08-20'); assert.equal(c.endDate, '2027-08-22');
  assert.deepEqual(c.lineup, artists); assert.equal(evaluateCandidate(current, c).publishable, false);
});

const card = d => `<a href="${d.url}"><div data-widget_type="theme-post-title.default"><h2>${d.heading}</h2></div></a>`;
const lineupHtml = (documents) => `<link rel="canonical" href="${lineupUrl}"><main><h1>LINE-UP</h1>${documents.map(card).join('')}</main>`;
const bandHtml = d => `<title>${d.title.replace('&','&amp;')}</title><link rel="canonical" href="${d.canonical}"><div data-elementor-type="single-post"><h1>${d.heading}</h1><a href="${lineupUrl}">TERUG NAAR LINE-UP 2027</a></div><footer></footer><script type="application/ld+json" class="dmf-schema">${JSON.stringify(d.event)}</script>`;
const fetchMock = (override) => {
  const calls = [];
  const fetchImpl = async u => {
    calls.push(u); const custom = override?.(u); if(custom) return custom;
    if(u === url) return new Response(fixture + `<a href="${lineupUrl}">Line-Up</a>`);
    if(u === lineupUrl) return new Response(lineupHtml(docs));
    const d = docs.find(d => d.url === u); assert.ok(d, "Only actual official artist cards may be fetched"); return new Response(bandHtml(d));
  };
  return { calls, fetchImpl };
};

test("deployed fetch pipeline discovers every actual card and extracts all eleven artists", async () => {
  const mock = fetchMock(); const fetched = await fetchSource(source(), {fetchImpl:mock.fetchImpl,maxAttempts:1});
  assert.equal(fetched.attempts, 13);
  assert.deepEqual(mock.calls, [url, lineupUrl, ...docs.map(d => d.url)]);
  assert.deepEqual(extractFestivalCandidate(await fetched.response.text(), source(), at).lineup, artists);
});

test("linked HTTP 403/schema failure/redirect is a source failure, never an incomplete successful bill", async () => {
  for (const failure of [() => new Response('blocked',{status:403}), () => new Response('<h1>Fulci</h1>'), () => { const r=new Response(bandHtml(docs[8])); Object.defineProperty(r,'url',{value:'https://evil.example/'});return r; }]) {
    const mock = fetchMock(u => u.endsWith('/fulci/') ? failure() : undefined);
    await assert.rejects(fetchSource(source(), {fetchImpl:mock.fetchImpl,maxAttempts:1}), /Dynamo/);
  }
});

test("navigation/external band links are not fetched and other configured sources stay unchanged", async () => {
  const mock = fetchMock(u => u === lineupUrl ? new Response(lineupHtml(docs) .replace('</main>', '<a href="https://evil.example/bands/x/"><div data-widget_type="theme-post-title.default"><h2>X</h2></div></a><a href="https://dynamo-metalfest.nl/bands/not-a-card/">News</a></main>')) : undefined);
  await fetchSource(source(),{fetchImpl:mock.fetchImpl,maxAttempts:1}); assert.equal(mock.calls.length,13);
  const other = fetchMock(); await fetchSource(source({festivalSlug:'other'}),{fetchImpl:other.fetchImpl,maxAttempts:1});assert.deepEqual(other.calls,[url]);
});
