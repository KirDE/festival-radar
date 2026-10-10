import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { envelopeKind } from "../lib/ingestion/adapters/rock-imperium.ts";
const fixture = n => readFileSync(new URL(`./fixtures/rock-imperium/${n}.html`, import.meta.url), "utf8");
const source = { festivalSlug: "rock-imperium", url: "https://www.rockimperiumfestival.es/", strategies: ["json_ld_event", "html_fallback"], editionYear: 2027, enabled: true, refreshPolicy: "daily" };
const landing = "https://www.madnesslive.es/es/pagina/377-rock-imperium-festival-2027";
const category = "https://www.madnesslive.es/es/85-rock-imperium-festival-2027";
const product = "https://www.madnesslive.es/es/rock-imperium-festival-2027/2041-comprar-entrada-abono-rock-imperium-festival-2027-cartagena.html";
const files = () => new Map([[source.url, fixture("home")], [landing, fixture("landing")], [category, fixture("category")], [product, fixture("product")]]);
const envelope = () => ({ kind: envelopeKind, home: fixture("home"), documents: [{ url: landing, html: fixture("landing") }, { url: category, html: fixture("category") }, { url: product, html: fixture("product") }] });
const extract = (e = envelope(), s = source) => extractFestivalCandidate(JSON.stringify(e), s, "2026-10-10T15:30:00Z");

test("real correction: stale navigation loses to verified current gateway and enabled general pass", () => {
  const c = extract();
  assert.equal(c.startDate, "2027-07-02"); assert.equal(c.endDate, "2027-07-04");
  assert.equal(c.ticketsUrl, source.url); assert.equal(c.ticketStatus, "available");
  assert.equal(c.lineup, undefined); assert.equal(c.headliners, undefined); assert.equal(c.status, undefined);
  assert.deepEqual(c.warnings, []); assert.deepEqual(c.observedEditionYears, [2027]);
  assert.equal(c.evidence.find(e => e.field === "ticketStatus").sourceUrl, product);
});
test("corrected partial bill, dates and tickets remain untouched by the corrected parse", () => {
  const current = { slug: "rock-imperium", editionYear: 2027, startDate: "2027-07-02", endDate: "2027-07-04", ticketsUrl: source.url, ticketStatus: "available", status: "partial", headliners: ["Bruce Dickinson", "Children of Bodom", "Helloween"], lineup: ["Mayhem", "Erik Grönwall"] };
  const r = evaluateCandidate(current, extract()); assert.deepEqual(r.changes, []); assert.deepEqual(r.reviewReasons, []);
});
test("later edition, dates, landing/category/product identifiers are discovered, never frozen", () => {
  const e = JSON.parse(JSON.stringify(envelope()).replaceAll("2027", "2028").replaceAll("377-", "888-").replaceAll("/85-", "/99-").replaceAll("2041-", "9000-").replaceAll("2-3-4 Julio", "4-5-6 Agosto"));
  const c = extract(e, { ...source, editionYear: 2028 });
  assert.equal(c.ticketStatus, "available"); assert.equal(c.startDate, "2028-08-04"); assert.equal(c.endDate, "2028-08-06");
});
for (const change of ["disabled", 'disabled="disabled"', 'aria-disabled="true"']) test(`disabled current pass is not available: ${change}`, () => {
  const e = envelope(); e.documents[2].html = e.documents[2].html.replace('type="submit"', `type="submit" ${change}`);
  assert.equal(extract(e).ticketStatus, undefined);
});
test("sold-out, early-bird exhaustion and generic gateway CTA never prove pass availability", () => {
  const e = envelope(); e.documents[2].html = e.documents[2].html.replace("Comprar\n", "Agotado\n") + '<p>Early bird tickets sold out</p><a>Buy tickets</a>';
  assert.equal(extract(e).ticketStatus, undefined);
  e.documents.pop(); assert.equal(extract(e).ticketStatus, undefined);
});
test("stale title or wrong general-pass edition fails closed", () => {
  const e = envelope(); e.home = e.home.replaceAll("2027", "2026"); assert.equal(extract(e).ticketsUrl, undefined);
  const p = envelope(); p.documents[2].html = p.documents[2].html.replaceAll("2027", "2026"); assert.equal(extract(p).ticketStatus, undefined);
});
test("impossible calendar dates are not published", () => {
  const e = envelope(); e.home = e.home.replace("2-3-4 Julio", "29-30-31 Febrero"); const c = extract(e); assert.equal(c.startDate, undefined); assert.equal(c.endDate, undefined);
});
test("ambiguous current seller gateways do not select the first link", () => {
  const e = envelope(); e.home += `<a href="${landing.replace("377-", "888-")}">Entradas</a>`; assert.equal(extract(e).ticketsUrl, undefined);
});
test("missing primary purchase form or only related product buttons do not prove availability", () => {
  const e = envelope(); e.documents[2].html = e.documents[2].html.replace('id="add-to-cart-or-refresh"', 'id="related-product"'); assert.equal(extract(e).ticketStatus, undefined);
});
test("commented gateway and foreign seller are ignored; no lineup replacement from old news", () => {
  const e = envelope(); e.home = `<title>Rock Imperium Festival 2027</title><!-- <a href="${landing}">Entradas</a> --><a href="https://evil.example/es/pagina/377-rock-imperium-festival-2027">Entradas</a><section class="lineup">Old artist</section>`;
  const c = extract(e); assert.equal(c.ticketsUrl, undefined); assert.equal(c.lineup, undefined);
});
test("fetch discovers exactly four live documents and skips stale navigation/PMR products", async () => {
  const pages = files(), requests = [];
  const result = await fetchSource(source, { maxAttempts: 1, fetchImpl: async (url, options) => {
    requests.push(url); assert.ok(pages.has(url)); if (url !== source.url) assert.equal(options.redirect, "error"); return new Response(pages.get(url));
  } });
  assert.deepEqual(requests, [...pages.keys()]); assert.equal(result.attempts, 4); assert.equal(extractFestivalCandidate(await result.response.text(), source, "now").ticketStatus, "available");
});
test("future live link IDs are followed rather than pinned to historical documents", async () => {
  const pages = new Map([...files()].map(([u, html]) => [u.replaceAll("377-", "888-").replaceAll("/85-", "/99-").replaceAll("2041-", "9000-"), html.replaceAll("377-", "888-").replaceAll("/85-", "/99-").replaceAll("2041-", "9000-")]));
  const result = await fetchSource(source, { maxAttempts: 1, fetchImpl: async u => { assert.ok(pages.has(u)); return new Response(pages.get(u)); } });
  assert.equal(extractFestivalCandidate(await result.response.text(), source, "now").ticketStatus, "available");
});
test("genuine linked seller 403 remains HTTP failure and source-backoff input", async () => {
  const pages = files(); const result = await fetchSource(source, { maxAttempts: 1, fetchImpl: async u => u === product ? new Response("blocked", { status: 403 }) : new Response(pages.get(u)) });
  assert.equal(result.response.status, 403); assert.equal(result.attempts, 4);
});
test("network failure is not converted into parser success", async () => {
  await assert.rejects(fetchSource(source, { maxAttempts: 1, fetchImpl: async u => { if (u !== source.url) throw new Error("network"); return new Response(fixture("home")); } }), /network/);
});
test("ambiguous general-pass product cards are not selected", async () => {
  const pages = files(); pages.set(category, fixture("category") + fixture("category").replaceAll("2041-", "9999-"));
  const requests = []; const result = await fetchSource(source, { fetchImpl: async u => { requests.push(u); return new Response(pages.get(u)); } });
  assert.equal(requests.length, 3); assert.equal(extractFestivalCandidate(await result.response.text(), source, "now").ticketStatus, undefined);
});
test("product redirect mismatch is rejected, not used as general-pass evidence", async () => {
  const pages = files(); await assert.rejects(fetchSource(source, { fetchImpl: async u => { const r = new Response(pages.get(u)); if (u === product) Object.defineProperty(r, "url", { value: "https://evil.example/" }); return r; } }), /redirected/);
});
test("unrelated festivals and manual-review strategy keep existing behavior", () => {
  const c = extractFestivalCandidate('<a href="https://tickets.example/">Tickets</a>', { ...source, festivalSlug: "other" }, "now"); assert.equal(c.ticketsUrl, "https://tickets.example/");
  const m = extractFestivalCandidate(fixture("home"), { ...source, strategies: ["manual_review"] }, "now"); assert.equal(m.ticketsUrl, undefined); assert.match(m.warnings[0], /Manual review/);
});

test("production bot English navigation follows translated product slug and Buy control", async () => {
  const pages = new Map([...files()].map(([u, html]) => [u === source.url ? u : u.replaceAll("/es/", "/en/").replaceAll("comprar-entrada", "buy-tickets"), html.replaceAll("/es/", "/en/").replaceAll("comprar-entrada", "buy-tickets").replaceAll("Comprar entradas", "Buy tickets").replaceAll("Comprar\n", "Buy\n")]));
  const r = await fetchSource(source, { maxAttempts: 1, fetchImpl: async u => { assert.ok(pages.has(u)); return new Response(pages.get(u)); } });
  const c = extractFestivalCandidate(await r.response.text(), source, "now"); assert.equal(c.ticketStatus, "available"); assert.deepEqual(c.warnings, []);
});
