import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { polandrockAnnouncementUrl } from "../lib/ingestion/adapters/polandrock.ts";
const fixture = (name) => readFile(new URL(`./fixtures/official-markup/polandrock-${name}.html`, import.meta.url), "utf8");
const home = await fixture("home"), article = await fixture("announcement");
const source = { festivalSlug: "polandrock", url: "https://polandrockfestival.pl/", strategies: ["json_ld_event", "html_fallback"], refreshPolicy: "daily", enabled: true, editionYear: 2027 };
const url = polandrockAnnouncementUrl(home, source);
const combined = (h = home, a = article, u = url) => `${h}<template data-pnr-announcement-source="${encodeURIComponent(u)}">${a}</template>`;
const parse = (h = combined(), s = source) => extractFestivalCandidate(h, s, "2026-10-10T14:50:00Z");
const current = { slug: "polandrock", editionYear: 2027, startDate: "2027-07-29", endDate: "2027-07-31", lineup: ["Halestorm", "Kula Shaker"], headliners: [], status: "partial", ticketStatus: "unknown" };

test("real correction: narrow artist headings, dated 33rd edition, no inferred headliners/tickets", () => {
  const c = parse();
  assert.deepEqual(c.lineup, current.lineup);
  assert.equal(c.startDate, current.startDate); assert.equal(c.endDate, current.endDate);
  assert.equal(c.status, "partial"); assert.equal(c.headliners, undefined);
  assert.equal(c.ticketStatus, undefined); assert.equal(c.ticketsUrl, undefined);
  assert.deepEqual(c.observedEditionYears, [2027]); assert.deepEqual(c.warnings, []);
  assert.equal(c.evidence.find(e => e.field === "endDate").sourceUrl, url);
  const result = evaluateCandidate(current, c);
  assert.deepEqual(result.changes, []); assert.deepEqual(result.reviewReasons, []);
});
test("later official card is extracted without fixed names, news text and stage labels remain excluded", () => {
  const card = '<article class="artists-carousel__item"><a href="/program?event_id=6065"></a><div class="artists-carousel__heading"><h2>New Band &amp; Friends</h2></div><p>Duża Scena: Metallica biography</p></article>';
  const c = parse(combined(home.replace('</section>', `${card}</section>`)));
  assert.deepEqual(c.lineup, [...current.lineup, "New Band & Friends"]);
  assert.equal(evaluateCandidate(current, c).publishable, true);
});
test("missing card requires review; existing partial lineup and headliners cannot be silently overwritten", () => {
  const c = parse(combined(home.replace('<h2>Halestorm</h2>', '<h3>Halestorm</h3>')));
  const r = evaluateCandidate({ ...current, headliners: ["Verified Headliner"] }, c);
  assert.equal(r.publishable, false); assert.ok(r.reviewReasons.includes("Removals require confirmation"));
  assert.equal(c.headliners, undefined);
});
test("future edition and changed date announcement are supported without document hash pinning", () => {
  const h = home.replaceAll('2027-07-29', '2028-07-27').replaceAll('header-33.svg', 'header-34.svg').replaceAll('33-polandrock-festival', '34-polandrock-festival');
  const futureUrl = polandrockAnnouncementUrl(h, { ...source, editionYear: 2028 });
  const c = parse(combined(h, article.replace('29-31.07.2027', '27-29.07.2028'), futureUrl), { ...source, editionYear: 2028 });
  assert.equal(c.startDate, '2028-07-27'); assert.equal(c.endDate, '2028-07-29'); assert.deepEqual(c.warnings, []);
});
test("stale countdown cannot publish a roster into another source edition", () => {
  const c = parse(combined(home.replace('2027-07-29', '2026-07-29')));
  assert.equal(c.lineup, undefined); assert.equal(c.startDate, undefined);
  assert.equal(evaluateCandidate(current, c).publishable, false);
});
test("conflicting or invalid announcement dates do not override verified dates", () => {
  for (const date of ['28-31.07.2027', '29-32.07.2027', '29-31.07.2026']) {
    const c = parse(combined(home, article.replace('29-31.07.2027', date)));
    assert.equal(c.endDate, undefined); assert.equal(evaluateCandidate(current, c).publishable, false);
  }
  const c = parse(combined(home.replace('2027-07-29', '2027-99-29')));
  assert.equal(c.lineup, undefined); assert.ok(c.warnings.length);
});
test("no dated announcement is not failure and never guesses end date or festival duration", () => {
  const c = parse(home);
  assert.equal(c.endDate, undefined); assert.deepEqual(c.warnings, []);
  assert.deepEqual(evaluateCandidate(current, c).changes, []);
});
test("scripts/comments cannot inject artist titles or dates", () => {
  const injected = `<script>${home.replaceAll('Halestorm', 'Fake Band')}</script><!-- ${home} -->`;
  const c = parse(combined(injected + home));
  assert.deepEqual(c.lineup, current.lineup); assert.deepEqual(c.warnings, []);
});
test("foreign announcement provenance is rejected", () => {
  const c = parse(combined(home, article, 'https://untrusted.test/aktualnosci/x'));
  assert.equal(c.endDate, undefined); assert.ok(c.warnings.length);
});
test("discovery refuses foreign and obsolete-edition news links", () => {
  const foreign = `<a href="https://untrusted.test/aktualnosci/band-33-polandrock-festival">Fake</a>`;
  assert.equal(polandrockAnnouncementUrl(foreign + home, source), url);
  assert.equal(polandrockAnnouncementUrl(home.replaceAll('33-polandrock-festival', '32-polandrock-festival'), source), undefined);
});
test("live transport combines official homepage and discovered dates with correct evidence URL", async () => {
  const calls = [];
  const result = await fetchSource(source, { maxAttempts: 1, fetchImpl: async (u) => { calls.push(u); return new Response(calls.length === 1 ? home : article, { status: 200 }); } });
  assert.deepEqual(calls, [source.url, url]); assert.equal(result.attempts, 2);
  const c = parse(await result.response.text()); assert.deepEqual(c.lineup, current.lineup); assert.equal(c.endDate, current.endDate);
});
test("403 on discovered official article remains HTTP403 for scheduler backoff", async () => {
  let n = 0;
  const result = await fetchSource(source, { maxAttempts: 1, fetchImpl: async () => new Response(++n === 1 ? home : 'Forbidden', { status: n === 1 ? 200 : 403 }) });
  assert.equal(result.response.status, 403); assert.equal(result.attempts, 2);
});
test("off-origin redirect is rejected, no announcement makes only one healthy request", async () => {
  let n = 0;
  await assert.rejects(fetchSource(source, { maxAttempts: 1, fetchImpl: async () => { const r = new Response(++n === 1 ? home : article); if (n === 2) Object.defineProperty(r, 'url', { value: 'https://untrusted.test/news' }); return r; } }), /redirected off official origin/);
  n = 0;
  const r = await fetchSource(source, { maxAttempts: 1, fetchImpl: async () => { n++; return new Response(home.replaceAll('33-polandrock-festival', '32-polandrock-festival')); } });
  assert.equal(n, 1); assert.deepEqual(parse(await r.response.text()).lineup, current.lineup);
});
