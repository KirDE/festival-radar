import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parserSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const html = await readFile(new URL("./fixtures/official-markup/pinkpop-lineup-2027.html", import.meta.url), "utf8");
const source = parserSource("pinkpop", { url: "https://www.pinkpop.nl/" });
const parse = (value = html) => extractFestivalCandidate(value, source, "2026-10-27T08:39:00Z");
const current = { slug: "pinkpop", editionYear: 2027, startDate: "2027-06-18", endDate: "2027-06-20", city: "Landgraaf", status: "tba", ticketStatus: "unavailable", headliners: [], lineup: [] };
const card = (name, { href = "/line-up/new-act/", billing = "else" } = {}) => `<a href="${href}" class="${billing} friday js-tilt"><article><h3 class="teaser-title">${name}</h3><h5>Vrijdag 18 juni</h5></article></a>`;
const page = (cards) => `<title>Pinkpop 2027</title><main><div class="date">18 • 19 • 20 juni 2027</div>${cards}</main>`;

test("Pinkpop real homepage extracts all 31 announced acts with official billing", () => {
  const result = parse();
  assert.deepEqual(result.headliners, ["blink-182", "Mumford & Sons", "RAYE"]);
  assert.deepEqual(result.lineup, ["Nothing But Thieves", "The Prodigy", "Sting 3.0", "5 Seconds of Summer", "Kacey Musgraves", "Myles Smith", "The Neighbourhood", "Turnstile", "Antoon", "Bastille", "beabadoobee", "Foals", "Froukje", "Milolaathetlukken", "The Opposites", "Royal Blood", "Wolf Alice", "Amble", "The Bausa", "Chance Peña", "CHVRCHES", "Dylan Gossett", "Jett Rebel", "jet van der steen", "Keo", "The Mary Wallopers", "South Arcade", "MAZOO"]);
  assert.equal(result.startDate, "2027-06-18"); assert.equal(result.endDate, "2027-06-20"); assert.equal(result.city, "Landgraaf");
  assert.deepEqual(result.observedEditionYears, [2027]);
  assert.equal(result.status, "partial"); assert.equal(result.artistListMode, "additive"); assert.equal(result.lineupScope, "announcement");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.ticketStatus, undefined); assert.equal(result.ticketsUrl, undefined);
  assert.ok(result.evidence.filter(e => ["headliners", "lineup"].includes(e.field)).every(e => /blink-182/.test(e.excerpt) && e.sourceUrl === source.url));
  const evaluation = evaluateCandidate(current, result);
  assert.equal(evaluation.publishable, true); assert.deepEqual(evaluation.reviewReasons, []);
  assert.equal(evaluation.changes.filter(c => ["artist_added", "headliner_added"].includes(c.kind)).length, 31);
});

test("Pinkpop accepts later names, entities and duplicate responsive cards without hardcoded counts", () => {
  const result = parse(page(card("New &amp; Future &#x26; Guests") + card("new &amp; future &#38; guests") + card("Fresh Headliner", { billing: "headliner" })));
  assert.deepEqual(result.lineup, ["New & Future & Guests"]); assert.deepEqual(result.headliners, ["Fresh Headliner"]);
  assert.deepEqual(result.warnings, []);
});

test("Pinkpop homepage is additive and cannot erase saved acts or downgrade a complete bill", () => {
  const result = evaluateCandidate({ ...current, status: "confirmed", headliners: ["Verified Headliner"], lineup: ["Verified Artist"] }, parse());
  assert.ok(!result.changes.some(c => c.kind.endsWith("_removed") || c.field === "status"));
});

test("Pinkpop stale edition remains blocked by publication policy", () => {
  const result = parse(html.replaceAll("2027", "2026"));
  assert.deepEqual(result.observedEditionYears, [2026]);
  assert.equal(evaluateCandidate(current, result).publishable, false);
  assert.ok(evaluateCandidate(current, result).reviewReasons.some(r => /edition 2026/.test(r)));
});

test("Pinkpop ignores scripts, comments, navigation and footer artist cards", () => {
  const result = parse(`<nav>${card("Navigation")}</nav><script>${card("Script")}</script><!--${card("Comment")}-->${page(card("Actual"))}<footer>${card("Footer")}</footer>`);
  assert.deepEqual(result.lineup, ["Actual"]);
});

test("Pinkpop rejects external links and unrelated news links even with artist styling", () => {
  const result = parse(page(card("Actual") + card("External", { href: "https://other.test/line-up/fake/" }) + card("News", { href: "/news/fake/" })));
  assert.deepEqual(result.lineup, ["Actual"]);
});

test("Pinkpop preserves legacy date-only pages without inventing an empty lineup", async () => {
  const old = await readFile(new URL("./fixtures/official-markup/pinkpop.html", import.meta.url), "utf8");
  const result = parse(old);
  assert.equal(result.startDate, "2027-06-18"); assert.equal(result.city, "Landgraaf");
  assert.equal(result.lineup, undefined); assert.equal(result.status, undefined); assert.deepEqual(result.warnings, []);
});

test("Pinkpop artist cards without an edition date cannot produce a publishable bill", () => {
  const result = parse(page(card("Actual")).replace("18 • 19 • 20 juni 2027", "Dates coming soon"));
  assert.equal(result.lineup, undefined); assert.ok(result.warnings.length);
});

test("Pinkpop malformed or changed artist cards surface review instead of silently returning dates only", () => {
  for (const broken of [card("Actual").replace("<h3", "<h4").replace("</h3>", "</h4>"), card("Actual", { billing: "unknown-tier" })]) {
    const result = parse(page(broken));
    assert.equal(result.lineup, undefined);
    assert.match(result.warnings.join(" "), /Pinkpop.*artist.*markup/i);
    assert.equal(evaluateCandidate(current, result).publishable, false);
  }
});
