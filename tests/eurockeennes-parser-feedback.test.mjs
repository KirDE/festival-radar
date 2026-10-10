import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const observedAt = "2026-10-10T12:00:00.000Z";
const source = { festivalSlug: "eurockeennes", url: "https://www.eurockeennes.fr/", editionYear: 2027, strategies: ["html_fallback"], enabled: true, refreshPolicy: "daily" };
const fixture = () => readFile(new URL("./fixtures/official-markup/eurockeennes-feedback.html", import.meta.url), "utf8");
const parse = (html, overrides = {}) => extractFestivalCandidate(html, { ...source, ...overrides }, observedAt);

test("real Eurockéennes correction: French purchase link, current dates and first headliner, never shop or archive", async () => {
  const html = await fixture();
  const result = parse('<a href="https://shop.eurockeennes.fr/">Shop tickets</a>' + html + '<div class="artist">Obsolete Artist</div>');
  assert.equal(result.startDate, "2027-07-02");
  assert.equal(result.endDate, "2027-07-05");
  assert.equal(result.city, "Belfort");
  assert.deepEqual(result.headliners, ["MUSE"]);
  assert.equal(result.status, "partial");
  assert.equal(result.ticketsUrl, "https://www.eurockeennes.fr/achat/");
  assert.equal(result.lineup, undefined);
  assert.equal(result.ticketStatus, undefined, "a dated news story is not current ticket stock");
  assert.deepEqual(result.observedEditionYears, [2027]);
  assert.deepEqual(result.warnings, []);
});

test("later official edition and changed first headliner are parsed without pinning artist, year or hash", async () => {
  const html = (await fixture()).replaceAll("2027", "2028").replaceAll("MUSE", "NEW HEADLINER");
  const result = parse(html, { editionYear: 2028 });
  assert.equal(result.startDate, "2028-07-02");
  assert.deepEqual(result.headliners, ["NEW HEADLINER"]);
  assert.equal(result.status, "partial");
});

test("wrong edition, impossible and non-consecutive dates cannot propose current facts", async () => {
  const html = await fixture();
  for (const invalid of [html.replaceAll("2027", "2026"), html.replace("2, 3, 4 et 5 juillet", "2, 3, 4 et 32 juillet"), html.replace("2, 3, 4 et 5 juillet", "2, 3, 4 et 6 juillet")]) {
    const result = parse(invalid);
    assert.equal(result.evidence.length, 0);
    assert.equal(result.headliners, undefined);
    assert.equal(result.ticketsUrl, undefined);
  }
});

test("comments and later programme stories invalidate obsolete first-wave billing", async () => {
  const html = await fixture();
  const firstOnly = '<title>Les Eurockéennes de Belfort – 2, 3, 4 et 5 juillet 2027</title>';
  const commented = parse(firstOnly + '<!--' + html.replace(/<title[\s\S]*?<\/title>/, "").replace(/<!--[\s\S]*?-->/g, "") + '-->');
  assert.equal(commented.headliners, undefined);
  const later = parse(html + '<a class="uneactu categorie-eurocks-2027" title="Toute la programmation" href="/actualite/programmation-2027/">Programme complet</a>');
  assert.equal(later.headliners, undefined);
  assert.equal(later.status, undefined);
});

test("live purchase cards distinguish on-sale tickets from future formulas and hidden/commented offers", () => {
  const title = '<title>Eurocks 2027 | Les Eurockéennes de Belfort – 2, 3, 4 et 5 juillet 2027</title><h1 class="entry-title">Eurocks 2027 : première annonce !</h1>';
  const pending = '<a class="lkbill27 dispo" href="/achat/">AUTRES FORMULES BIENTÔT DISPONIBLES Disponible</a>';
  const priced = '<a class="lkbill27 dispo" href="/achat/">FORFAIT 4 JOURS 219€ Disponible</a>';
  assert.equal(parse(title + pending).ticketStatus, undefined);
  assert.equal(parse(title + pending + '<!--' + priced + '-->').ticketStatus, undefined);
  assert.equal(parse(title + priced.replace('class="', 'style="display: none;" class="')).ticketStatus, undefined);
  assert.equal(parse(title + pending + priced).ticketStatus, "available");
  assert.equal(parse(title + priced.replace("Disponible", "Épuisé")).ticketStatus, undefined);
});

test("partial candidate preserves verified support acts and never publishes headliner removals", async () => {
  const candidate = parse(await fixture());
  const current = { slug: "eurockeennes", editionYear: 2027, headliners: ["MUSE", "Verified Headliner"], lineup: ["Verified Support"], status: "partial", ticketStatus: "available", ticketsUrl: "https://www.eurockeennes.fr/achat/", startDate: "2027-07-02", endDate: "2027-07-05", city: "Belfort" };
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.changes.some(change => change.kind === "headliner_removed" && change.reviewRequired));
  assert.ok(!result.changes.some(change => change.kind === "artist_removed"));
  assert.equal(current.lineup[0], "Verified Support");
});
