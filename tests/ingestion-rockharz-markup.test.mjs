import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { publishIngestionResult } from "../lib/catalog/publication.ts";
import { sourceParserKey } from "../lib/sources/repository.ts";
import { parserSource } from "./support/parser-source.ts";

const origin = "https://www.rockharz-festival.com";
const urls = { bands: origin + "/bands", headliner: origin + "/headliner-alarm", soldout: origin + "/das-rockharz-2027-ist-ausverkauft", market: "https://ticketmarktplatz.rockharz-festival.com/" };
const fixtures = Object.fromEntries(await Promise.all(Object.keys(urls).map(async (key) => [key, await readFile(new URL(`./fixtures/official-markup/rockharz-${key}-2027.html`, import.meta.url), "utf8")])));
const at = "2026-10-08T00:00:00Z";
const source = (key, overrides = {}) => parserSource("rockharz", { url: urls[key], ...overrides });
const extract = (key, html = fixtures[key], overrides) => extractFestivalCandidate(html, source(key, overrides), at);
const artists = ["ACCEPT", "ALESTORM", "ALL FOR METAL", "ARCH ENEMY", "BRUCE DICKINSON", "COPPELIUS", "DARTAGNAN", "DUST BOLT", "EISBRECHER", "EMIL BULLS", "EQUILIBRIUM", "GRAVE DIGGER", "GUTALAX", "GWAR", "H-BLOCKX", "HANDGEMENG", "IGELS VS. SHARK", "KATERFAHRT", "KORPIKLAANI", "LORD OF THE LOST", "MARDUK", "METAL CHURCH", "NESTOR", "SETYOURSAILS", "SKALD", "STORMSEEKER", "TANKARD", "THE SISTERS OF MERCY", "TURBOBIER"];
const canonicalArtists = artists.map((name) => ({ "IGELS VS. SHARK": "IGEL VS. SHARK", SETYOURSAILS: "SETYØURSAILS", SKALD: "SKÁLD" })[name] ?? name);
const current = { slug: "rockharz", name: "Rockharz Open Air", editionYear: 2027, country: "DE", officialUrl: origin, startDate: "2027-07-07", endDate: "2027-07-10", city: "Ballenstedt", status: "announced", ticketStatus: "unknown", headliners: [], lineup: [] };
const fields = ["lineup", "headliners", "startDate", "endDate", "city", "status", "ticketStatus", "ticketsUrl"];
const first = fixtures.bands.match(/<div class="band_item">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
const newTile = (name, id) => first.replace('title="ACCEPT"', `title="${name}"`).replaceAll("synthetic-0", `synthetic-new-${id}`);
const appendTiles = (html, tiles) => html.replace("\n</div>\n</div></div></div>", "\n" + tiles + "\n</div>\n</div></div></div>");
function noEvidence(key, html, overrides) {
  const candidate = extract(key, html, overrides);
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.observedEditionYears, []);
  for (const field of fields) assert.equal(candidate[field], undefined, `${key}: ${field}`);
  assert.ok(candidate.warnings.length);
  const result = evaluateCandidate({ ...current, lineup: canonicalArtists, headliners: ["AMON AMARTH"] }, candidate);
  assert.deepEqual(result.changes, []); // invalid source cannot propose removals
  assert.equal(result.publishable, false);
}
function onlyFields(key, candidate, expected) {
  assert.deepEqual(candidate.evidence.map(({ field }) => field).sort(), [...expected].sort());
  for (const field of fields.filter((f) => !expected.includes(f))) assert.equal(candidate[field], undefined);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.ok(candidate.evidence.every((e) => e.sourceUrl === urls[key] && e.observedAt === at && e.excerpt));
}

test("actual tile shape uses anchor captions/news assets, distinct thumbnails and harmless duplicate class", () => {
  assert.equal(sourceParserKey(source("bands")), "official_markup:rockharz");
  const candidate = extract("bands");
  assert.deepEqual(candidate.lineup, canonicalArtists);
  onlyFields("bands", candidate, ["lineup"]);
  assert.match(candidate.evidence[0].excerpt, /IGELS VS\. SHARK → IGEL VS\. SHARK/);
  assert.deepEqual(candidate.warnings, []);
  assert.equal(evaluateCandidate(current, candidate).publishable, true);
  assert.deepEqual(extract("bands", fixtures.bands.replace('rel="band" class="ngg-simplelightbox"', 'rel="band"')).lineup, canonicalArtists);
});

test("new wave accepts bounded new captions only with every baseline name, and stays provisional REVIEW", () => {
  const additional = Array.from({ length: 10 }, (_, i) => `SYNTHETIC NEW BAND ${i}`);
  const html = appendTiles(fixtures.bands, additional.map((name, i) => newTile(name, i)).join("\n"));
  const candidate = extract("bands", html);
  assert.deepEqual(candidate.lineup, [...canonicalArtists, ...additional]);
  onlyFields("bands", candidate, ["lineup"]);
  assert.match(candidate.warnings.join(";"), /New Rockharz captions are provisional/);
  const result = evaluateCandidate({ ...current, lineup: canonicalArtists }, candidate);
  assert.equal(result.publishable, false);
  assert.deepEqual(result.changes.map(({ after }) => after), additional);
  noEvidence("bands", html.replace(first, "")); // cannot substitute additions for baseline
  noEvidence("bands", appendTiles(fixtures.bands, Array.from({ length: 122 }, (_, i) => newTile(`NEW ${i}`, i)).join("\n")));
});

test("missing/altered baseline, duplicates, typo identities and ambiguous attributes fail closed", () => {
  for (const name of artists) noEvidence("bands", fixtures.bands.replace(`title="${name}"`, 'title="EXTRA ARTIST"'));
  for (const [name, slug] of [["IGELS VS. SHARK", "igelvsshark_v1a"], ["SETYOURSAILS", "setyoursails_v1a"], ["SKALD", "skald_v1a"]]) {
    noEvidence("bands", fixtures.bands.replace(`title="${name}"`, `title="${name} CHANGED"`));
    noEvidence("bands", fixtures.bands.replace(`news_band-announce_${slug}.jpg`, `news_band-announce_unreviewed.jpg`));
    noEvidence("bands", fixtures.bands.replace(`linkespalte_${slug}.jpg`, `linkespalte_unreviewed.jpg`));
  }
  noEvidence("bands", fixtures.bands.replace(first, ""));
  for (const name of ["GRAVE DIIGGER", "SKĀLD", "SKÀLD", "ACCEPT", "accept", "<b>EVIL</b>", "&#60;b&#62;EVIL&#60;/b&#62;", "&#8203;EVIL"]) noEvidence("bands", appendTiles(fixtures.bands, newTile(name, 1)));
  for (const [before, after] of [
    ['title="ACCEPT"', 'title="ACCEPT" title="ACCEPT"'],
    ['href="' + origin, 'href="https://evil.example/x" href="' + origin],
    ['rel="band" class="ngg-simplelightbox"', 'rel="band" class="other"'],
    ['rel="band" class="ngg-simplelightbox"', 'rel="band" class="ngg-simplelightbox" class="ngg-simplelightbox"'],
    ['title="ACCEPT"', 'alt="ACCEPT"'],
  ]) noEvidence("bands", fixtures.bands.replace(before, after));
});

test("anchor and image asset guards are independent, unique, official and edition-bound", () => {
  for (const [before, after] of [
    ["rhz2027_web_news_band-announce_", "rhz2026_web_news_band-announce_"],
    ["rhz2027_web_linkespalte_", "rhz2026_web_linkespalte_"],
    ["rhz2027_web_news_band-announce_", "rhz2027_web_linkespalte_"],
    ["synthetic-1.jpg", "synthetic-0.jpg"],
    ['href="' + origin + "/wp-content", 'href="https://evil.example/wp-content'],
    ['src="' + origin + "/wp-content", 'src="https://evil.example/wp-content'],
    ["synthetic-0.jpg", "synthetic-0.jpg?edition=2026"],
  ]) noEvidence("bands", fixtures.bands.replace(before, after));
});

test("closed post entry-content and content grid cannot borrow sidebar tiles or closing tags", () => {
  for (const [before, after] of [
    ['id="post-65077"', 'id="post-65078"'], ['id="content"', 'id="sidebar"'],
    ['class="entry-content clearfix"', 'class="sidebar"'], ["2027er", "2026er"],
    [first, first + "<p>EXTRA ARTIST</p>"], ['class="band_item"', 'class="band_item" style="display:none"'], [first, first.replace("</a>", "")],
    [first, first.replace('<div class="bandsocials">', '<div class="other">')],
  ]) noEvidence("bands", fixtures.bands.replace(before, after));
  const heading = fixtures.bands.match(/<h3>.*?<\/h3>/)[0];
  noEvidence("bands", fixtures.bands.replace(heading, heading + heading));
  noEvidence("bands", fixtures.bands.replace(first, "").replace("</body>", `<div id="sidebar">${first}</div></body>`));
  noEvidence("bands", fixtures.bands.replace('id="content"', 'id="content" id="content"'));
  noEvidence("bands", fixtures.bands.replace(first, `<div class="band_item">${first}</div>`));
});

test("dated headliner article yields explicit AMON AMARTH billing only", () => {
  const candidate = extract("headliner");
  assert.deepEqual(candidate.headliners, ["AMON AMARTH"]);
  onlyFields("headliner", candidate, ["headliners"]);
  assert.match(candidate.evidence[0].excerpt, /2026-10-07T14:30:22\+00:00/);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, true);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(result.changes.map(({ kind }) => kind), ["headliner_added"]);
  for (const [before, after] of [
    ['id="post-84153"', 'id="post-84154"'], ["HEADLINER-ALARM!", "HEADLINER!"],
    ["2026-10-07T14:30:22+00:00", "2026-10-08T14:30:22+00:00"],
    ["beim ROCKHARZ 2027!", "beim ROCKHARZ 2026!"], ["sind Headliner", "waren Headliner"],
    ["AMON AMARTH sind", "ANOTHER ARTIST sind"],
    ["<p>AMON AMARTH", "<p><strong>AMON AMARTH"],
  ]) noEvidence("headliner", fixtures.headliner.replace(before, after));
  noEvidence("headliner", fixtures.headliner.replace('class="entry-content clearfix"', 'class="entry-content clearfix" aria-hidden="true"'));
  const p = fixtures.headliner.match(/<p>AMON AMARTH.*?<\/p>/)[0];
  noEvidence("headliner", fixtures.headliner.replace(p, p + p));
  noEvidence("headliner", fixtures.headliner.replace(p, p + "<p>ANOTHER ARTIST is headliner.</p>"));
  noEvidence("headliner", fixtures.headliner.replace(p, "").replace("</body>", p + "</body>"));
});

test("marketplace hero parses corroborated evergreen dates and review-gated city changes; repeated footer only corroborates", () => {
  const candidate = extract("market");
  onlyFields("market", candidate, ["startDate", "endDate", "city"]);
  assert.equal(candidate.startDate, "2027-07-07");
  assert.equal(candidate.endDate, "2027-07-10");
  assert.equal(candidate.city, "Ballenstedt");
  const changed = extract("market", fixtures.market.replaceAll("7.–10.", "8.–11."));
  assert.equal(changed.startDate, "2027-07-08");
  assert.equal(changed.endDate, "2027-07-11");
  const result = evaluateCandidate(current, changed);
  assert.equal(result.publishable, false);
  assert.equal(result.changes.filter((c) => c.kind === "date_changed" && c.reviewRequired).length, 2);
  const unchanged = evaluateCandidate(current, candidate);
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(unchanged.reviewReasons, []);
  const august = extract("market", fixtures.market.replaceAll("Juli", "August"));
  assert.equal(august.startDate, "2027-08-07");
  assert.equal(august.endDate, "2027-08-10");
  assert.deepEqual(august.warnings, []);
  assert.equal(evaluateCandidate(current, august).publishable, false);
  assert.equal(evaluateCandidate(current, august).changes.filter((c) => c.reviewRequired).length, 2);
  const moved = extract("market", fixtures.market.replaceAll("Ballenstedt", "Other City"));
  assert.equal(moved.city, "Other City");
  assert.match(moved.warnings.join(";"), /venue city changed/);
  assert.equal(evaluateCandidate(current, moved).publishable, false);
  for (const date of ["29.–31. Februar", "30.–32. August", "0.–3. August"])
    noEvidence("market", fixtures.market.replaceAll("7.–10. Juli", date));
  noEvidence("market", fixtures.market.replaceAll("Juli 2027", "August 2026"));
  noEvidence("market", fixtures.market.replace(/<footer>[\s\S]*?<\/footer>/, ""));
  for (const [before, after] of [
    ["7.–10.", "10.–7."], ["7.–10.", "30.–32."], ["7.–10.", "0.–3."], ["7.–10.", "7.–7."],
    ["7.–10.", "7.–20."], ["Juli 2027", "Juli 2026"], ["Juli 2027", "August 2027"],
    ["Ballenstedt", "Other City"], ['class="hero"', 'class="sidebar"'], ['id="top"', 'id="archive"'],
    ['class="kicker mt-1"', 'class="footer-date"'], ["Ticketmarktplatz 2027</title>", "Ticketmarktplatz 2026</title>"],
  ]) noEvidence("market", fixtures.market.replace(before, after));
  noEvidence("market", fixtures.market.replace("<footer><p>7.–10.", "<footer><p>8.–11."));
  const hero = fixtures.market.match(/<div class="hero">[\s\S]*?<\/div>/)[0];
  noEvidence("market", fixtures.market.replace(hero, hero + hero));
  noEvidence("market", fixtures.market.replace(hero, ""));
  for (const wrapper of ["nav", "script", "footer"]) noEvidence("market", fixtures.market.replace(hero, `<${wrapper}>${hero}</${wrapper}>`));
  noEvidence("market", fixtures.market.replace("</head>", `<link rel="canonical" href="${origin}"></head>`));
});

test("dated soldout article emits typed unavailable ticketStatus through normal merger and evidence", () => {
  const candidate = extract("soldout");
  onlyFields("soldout", candidate, ["ticketStatus"]);
  assert.equal(candidate.ticketStatus, "unavailable");
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, true);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(result.changes.map(({ kind, after }) => [kind, after]), [["ticket_status_changed", "unavailable"]]);
  for (const [before, after] of [
    ['id="post-82346"', 'id="post-82347"'], ["2026-07-09T15:33:09+00:00", "2026-07-10T15:33:09+00:00"],
    ["DAS ROCKHARZ 2027 IST AUSVERKAUFT!", "DAS ROCKHARZ 2026 IST AUSVERKAUFT!"],
    ["für das ROCKHARZ 2027 sind", "für das ROCKHARZ 2026 sind"], ["sind vergriffen!", "sind erhältlich!"],
  ]) noEvidence("soldout", fixtures.soldout.replace(before, after));
  const statement = fixtures.soldout.match(/<div class="_1mf _1mj">.*?<\/div>/)[0];
  noEvidence("soldout", fixtures.soldout.replace(statement, statement + statement));
  noEvidence("soldout", fixtures.soldout.replace(statement, "").replace("</body>", statement + "</body>"));
});

test("exact URLs, source edition, independent identity metadata and complete documents are mandatory", () => {
  for (const key of Object.keys(urls)) {
    for (const url of [urls[key] + "?year=2027", urls[key] + "#content", urls[key].replace("https:", "http:"), urls[key].replace("rockharz-festival.com", "evil.example"), origin + "/", origin + "/erste-bandwelle-fuer-das-rockharz-2027"]) noEvidence(key, fixtures[key], { url });
    for (const editionYear of [undefined, 2026, 2028]) noEvidence(key, fixtures[key], { editionYear });
    noEvidence(key, fixtures[key], { fetchUrl: "https://evil.example/" });
    noEvidence(key, fixtures[key], { followLinkPattern: "^/bands$" });
    noEvidence(key, fixtures[key], { strategies: ["manual_review"], manualReviewReason: "Awaiting preflight" });
    for (const html of ["", fixtures[key].replace("</body>", ""), fixtures[key].replace("</html>", ""), fixtures[key].replace("</body>", "<div></body>")]) noEvidence(key, html);
    if (key !== "market") {
      for (const property of ["og:url", ...(key === "bands" ? [] : ["article:published_time"])]) {
        const meta = fixtures[key].match(new RegExp(`<meta property="${property}"[^>]*>`))[0];
        noEvidence(key, fixtures[key].replace(meta, ""));
        noEvidence(key, fixtures[key].replace(meta, meta + meta));
        noEvidence(key, fixtures[key].replace(meta, `<script>${meta}</script>`));
      }
      const canonical = fixtures[key].match(/<link rel="canonical"[^>]*>/)[0];
      noEvidence(key, fixtures[key].replace(canonical, ""));
      noEvidence(key, fixtures[key].replace(canonical, canonical + canonical));
      noEvidence(key, fixtures[key].replace(`href="${urls[key]}"`, `href="${urls[key]}/"`));
    }
    assert.ok(extract(key, fixtures[key], { fetchUrl: urls[key] }).evidence.length);
  }
});

test("navigation/JSON-LD/sidebar decoys never supply missing bounded evidence or merged fields", () => {
  const decoys = `<nav>${first}<p>AMON AMARTH sind Headliner beim ROCKHARZ 2027!</p></nav><script type="application/ld+json">{"name":"ROCKHARZ 2026","performer":"EXTRA ARTIST","startDate":"2026-07-01"}</script><div id="sidebar">${first}<p>7.–10. Juli 2026 · Ballenstedt</p></div>`;
  for (const key of ["bands", "headliner", "soldout"]) {
    const original = extract(key), candidate = extract(key, fixtures[key].replace("<body>", "<body>" + decoys));
    assert.deepEqual(candidate.evidence, original.evidence);
    for (const field of fields) assert.deepEqual(candidate[field], original[field]);
    for (const wrapper of ["nav", "script", "footer"]) {
      const body = fixtures[key].match(/<body>([\s\S]*)<\/body>/)[1];
      noEvidence(key, fixtures[key].replace(body, `<${wrapper}>${body}</${wrapper}>`));
    }
  }
  for (const [key, html] of Object.entries(fixtures)) {
    for (const other of Object.keys(urls).filter((k) => k !== key)) noEvidence(other, html);
  }
});

test("baseline artist/ticket sources are publishable; novel names and date/city moves reject before DB access", async () => {
  for (const key of ["bands", "headliner", "soldout"]) {
    const result = evaluateCandidate(current, extract(key));
    assert.equal(result.publishable, true);
    assert.deepEqual(result.reviewReasons, []);
  }
  let accesses = 0;
  const client = new Proxy({}, { get() { accesses++; throw new Error("Unexpected database access"); } });
  for (const [key, html] of [
    ["bands", appendTiles(fixtures.bands, newTile("NEW ARTIST", 1))],
    ["market", fixtures.market.replaceAll("Juli", "August")],
    ["market", fixtures.market.replaceAll("Ballenstedt", "Other City")],
  ]) {
    const result = evaluateCandidate(current, extract(key, html));
    assert.equal(result.publishable, false);
    await assert.rejects(publishIngestionResult(client, { attemptId: "synthetic-" + key, result, sourceCommit: "synthetic" }), /Refusing ambiguous ingestion publication/);
  }
  assert.equal(accesses, 0);
});
