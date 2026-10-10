import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { sourceParserKey } from "../lib/sources/repository.ts";
import { parserSource } from "./support/parser-source.ts";

const url = "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/";
const at = "2026-10-07T00:00:00Z";
const source = (overrides = {}) => parserSource("rockstadt", { url, ...overrides });
const extract = (html, overrides) => extractFestivalCandidate(html, source(overrides), at);
const fixture = await readFile(new URL("./fixtures/official-markup/rockstadt-announcement-2027.html", import.meta.url), "utf8");
const artists = ["Slash featuring Myles Kennedy and The Conspirators", "Overkill", "Mgla", "Venom", "Jinjer", "Towards the Sinister"];
const current = { slug: "rockstadt", name: "Rockstadt Extreme Fest", editionYear: 2027, country: "RO", officialUrl: "https://rockstadtextremefest.ro/", status: "announced", headliners: [], lineup: [] };
const announcement = `First confirmed names: <strong>${artists.join(", ")}</strong>`;
const desc = fixture.match(/<div class="event-short-desc">[\s\S]*?<\/div>/)[0];

function noEvidence(html, overrides) {
  const candidate = extract(html, overrides);
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.observedEditionYears, []);
  for (const field of ["startDate", "endDate", "city", "lineup", "headliners", "status"]) assert.equal(candidate[field], undefined);
  const result = evaluateCandidate({ ...current, lineup: artists }, candidate);
  assert.deepEqual(result.changes, []);
  assert.equal(result.publishable, false);
  assert.match(candidate.warnings.join("; "), /found no trustworthy fields/);
}

test("exact ticket article extracts only the six first names, dates, city and 2027 review evidence", () => {
  assert.equal(sourceParserKey(source()), "official_markup:rockstadt");
  const candidate = extract(fixture);
  assert.equal(candidate.startDate, "2027-07-26");
  assert.equal(candidate.endDate, "2027-07-30");
  assert.equal(candidate.city, "Ghimbav (Brașov)");
  assert.deepEqual(candidate.lineup, artists);
  assert.equal(candidate.headliners, undefined);
  assert.equal(candidate.status, "partial");
  assert.equal(candidate.artistListMode, "additive");
  assert.equal(candidate.ticketStatus, "available");
  assert.equal(candidate.ticketsUrl, url);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "city", "lineup", "status", "ticketStatus", "ticketsUrl"]);
  assert.ok(candidate.evidence.every((item) => item.sourceUrl === url && item.observedAt === at && item.excerpt.includes(announcement.replace(/<\/?strong>/g, ""))));
  assert.deepEqual(candidate.warnings, ["Agent review required before lineup-triggered provider activity"]);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.includes(candidate.warnings[0]));
  assert.deepEqual(result.changes.filter(({ kind }) => kind === "artist_added").map(({ after }) => after), artists);
});

test("manual_review homepage and ticket configurations stay inert until separately converted", () => {
  for (const sourceUrl of [current.officialUrl, url]) {
    const candidate = extract(fixture, { url: sourceUrl, strategies: ["manual_review"], manualReviewReason: "Official homepage requires review" });
    assert.deepEqual(candidate.evidence, []);
    assert.deepEqual(candidate.observedEditionYears, []);
    assert.equal(candidate.lineup, undefined);
    assert.match(candidate.warnings[0], /^Manual review only:/);
    assert.deepEqual(evaluateCandidate(current, candidate).changes, []);
    assert.equal(evaluateCandidate(current, candidate).publishable, false);
  }
});

test("only the exact source URL and edition 2027 are eligible", () => {
  for (const sourceUrl of [current.officialUrl, "https://bilete.rockstadtextremefest.ro/", url.slice(0, -1), url + "?year=2026", url + "#details", url.replace("2027-129242", "2026-123456"), url.replace("https:", "http:"), url.replace("bilete.rockstadtextremefest.ro", "evil.example")]) noEvidence(fixture, { url: sourceUrl });
  for (const editionYear of [2026, 2028, undefined]) noEvidence(fixture, { editionYear });
});

test("OG article identity is unique, mandatory and internally consistent", () => {
  for (const property of ["og:url", "og:type", "og:title"]) {
    const tag = fixture.match(new RegExp(`<meta property="${property}"[^>]*>`))[0];
    noEvidence(fixture.replace(tag, ""));
    noEvidence(fixture.replace(tag, tag + tag));
  }
  for (const [before, after] of [[`content="${url}"`, `content="${current.officialUrl}"`], ['content="article"', 'content="website"'], ['content="Rockstadt Fest 2027"', 'content="Rockstadt Fest 2026"'], ["26-30 iul &#039;27", "26-30 iul &#039;26"], ["26-30 iul &#039;27", "27-30 iul &#039;27"]]) noEvidence(fixture.replace(before, after));
  const og = fixture.match(/<meta property="og:url"[^>]*>/)[0];
  noEvidence(fixture.replace(og, "").replace("</body>", og + "</body>")); // footer metadata cannot supply identity
  noEvidence(fixture.replace(og, `<script type="application/ld+json">${og}</script>`));
  noEvidence(fixture.replace("Bilete Rockstadt Fest 2027", "Bilete Rockstadt Fest 2026"));
  noEvidence(fixture.replace("</head>", `<link rel="canonical" href="${current.officialUrl}"></head>`));
  assert.deepEqual(extract(fixture.replace("</head>", `<link rel="canonical" href="${url}"></head>`)).lineup, artists);
});

test("optional event metadata corroborates the id, name, dates and venue; malformed or duplicate metadata fails", () => {
  const metadata = fixture.match(/<script>[\s\S]*?<\/script>/)[0];
  assert.deepEqual(extract(fixture.replace(metadata, "")).lineup, artists); // OG alone is a sufficient identity anchor
  for (const [before, after] of [['"id":"129242"', '"id":"129241"'], ['"title":"Rockstadt Fest 2027"', '"title":"Rockstadt Fest 2026"'], ['"start_date":"2027-07-26"', '"start_date":"2026-07-26"'], ['"end_date":"2027-07-30"', '"end_date":"2027-07-31"'], ['"name":"Rockstadt Fest"', '"name":"Another event"'], ['Ghimbav (Bra\\u0219ov)', 'Râșnov'], ['{"pageData":', '{"pageData":BROKEN']]) noEvidence(fixture.replace(before, after));
  noEvidence(fixture.replace(metadata, metadata + metadata));
});

test("old edition, wrong heading, dates and location fail closed", () => {
  noEvidence(fixture.replaceAll("2027", "2026").replaceAll("'27", "'26").replaceAll("&#039;27", "&#039;26"));
  for (const [before, after] of [["<h1>Rockstadt Fest 2027</h1>", "<h1>Rockstadt Fest 2026</h1>"], ["26-30 iulie '27", "26-30 iulie '26"], ["26-30 iulie '27", "25-30 iulie '27"], ["26-30 iulie '27", "26-31 iulie '27"], ["26-30 iulie '27", "26-30 august '27"], ["<strong>Rockstadt Fest, Ghimbav (Brașov)</strong>", "<strong>Rockstadt Fest, Râșnov</strong>"], ["Starting with the 2027 edition", "Starting with the 2026 edition"]]) noEvidence(fixture.replace(before, after));
});

test("dynamic first-wave names are extracted without hardcoded identities or removals", () => {
  for (const names of [artists.slice(0, -1), [...artists, "Extra Artist"], ["Mgła", "Venom Inc.", "Slash"], ["Future Artist", "Another Artist"]]) {
    const candidate = extract(fixture.replace(artists.join(", "), names.join(", ")));
    assert.deepEqual(candidate.lineup, names);
    assert.equal(candidate.status, "partial");
    const result = evaluateCandidate({ ...current, lineup: artists }, candidate);
    assert.equal(result.changes.some(change => change.kind === "artist_removed"), false);
    if (names.some(name => !artists.includes(name))) assert.equal(result.publishable, false);
  }
  assert.deepEqual(extract(fixture.replace("A new name. The same heartbeat.", "More names to come this autumn.")).lineup, artists);
});

test("ambiguous, duplicate or malformed announcements fail closed", () => {
  for (const replacement of [artists.join(", ") + ", Overkill", "", ", Overkill", "1234", artists.join(", ").replace("Venom", "<em>Venom</em>")]) noEvidence(fixture.replace(artists.join(", "), replacement));
  noEvidence(fixture.replace(announcement, announcement + "<br>" + announcement));
  noEvidence(fixture.replace(desc, desc + desc));
  noEvidence(fixture.replace(announcement, announcement + "<br>Also confirmed: Extra Artist"));
  noEvidence(fixture.replace(announcement, announcement + "<br>Jinjer cancelled"));
});

test("navigation, JSON-LD, footer and unrelated event boxes cannot supply or expand evidence", () => {
  const decoys = `<nav><h1>Rockstadt Fest 2026</h1>${desc}</nav><script type="application/ld+json">{"@type":"Event","name":"Rockstadt 2026","performer":["Extra Artist"]}</script><footer>Extra Artist</footer>`;
  assert.deepEqual(extract(fixture.replace("<body>", "<body>" + decoys)).lineup, artists);
  for (const wrapper of ["nav", "footer", 'script type="application/ld+json"']) {
    const closing = wrapper.split(" ")[0];
    noEvidence(fixture.replace(desc, "").replace("</body>", `<${wrapper}>${desc}</${closing}></body>`));
  }
  noEvidence(fixture.replace('id="details"', 'id="archive"'));
  noEvidence(fixture.replace('class="event-short-desc"', 'class="navigation-desc"'));
  noEvidence(fixture.replace('<div class="date-location">', '<div></div><div class="date-location">'));
  noEvidence(fixture.replace(desc, "").replace("</body>", `<div id="details">${desc}</div></body>`));
  noEvidence(fixture.replace("<h1>Rockstadt Fest 2027</h1>", "").replace("</body>", "<nav><h1>Rockstadt Fest 2027</h1></nav></body>"));
});

test("empty, truncated and malformed documents cannot borrow closing tags or propose removals", () => {
  for (const html of ["", fixture.slice(0, fixture.indexOf(announcement)), fixture.slice(0, fixture.indexOf("Towards the Sinister") + 10), fixture.slice(0, fixture.indexOf("</body>")), fixture.replace("</strong>\n<br>", "\n<br>"), fixture.replace("<h1>", "<h2>"), fixture.replace('class="event-short-desc">', 'class="event-short-desc"'), fixture.replace("<br><br>", "<br><broken>"), fixture.replace("</div></div></div></div></section>", "</div></section>")]) noEvidence(html);
  noEvidence(fixture.replace("</body>", "</div></body>"));
  noEvidence(fixture.replace("</body>", "<div></body>"));
  noEvidence(fixture.replace('<div class="read-more" data-read-more="container">', '<div class="read-more" data-read-more="container" />'));
});

test("real public booking anchors prove sales; disabled, off-host, merch and stale prices do not", () => {
  for (const [before, after] of [
    ['class="order-form-widget can-book"', 'class="order-form-widget"'],
    ['data-disable-submit="0"', 'data-disable-submit="1"'],
    ['data-max-nr-tickets="20"', 'data-max-nr-tickets="0"'],
    ['data-is-ticket-nr="1"', 'data-is-ticket-nr="1" disabled="disabled"'],
    ['data-is-order-form-submit="true"', 'data-is-order-form-submit="true" disabled'],
    ['data-tariff-name="Abonament - Acces General"', 'data-tariff-name="Transport and Merchandise"'],
    ['data-tariff-sell-price="848.4"', 'data-tariff-sell-price="0"'],
    ['action="https://bilete.rockstadtextremefest.ro/widgetOrderForm/bookEvent/"', 'action="https://evil.example/book/"'],
    [`data-return-url="${url}"`, 'data-return-url="https://bilete.rockstadtextremefest.ro/2026/"'],
  ]) {
    const candidate = extract(fixture.replace(before, after));
    assert.deepEqual(candidate.lineup, artists);
    assert.equal(candidate.ticketStatus, undefined);
    assert.equal(candidate.ticketsUrl, undefined);
  }
  const noForm = fixture.replace(/<form\b[\s\S]*?<\/form>/, "");
  assert.equal(extract(noForm.replace('</head>', '<script type="application/ld+json">{"offers":{"availability":"InStock","price":800}}</script></head>')).ticketStatus, undefined);
  assert.equal(extract(fixture.replace('data-tariff-sell-price="848.4"', 'data-tariff-sell-price="950"')).ticketStatus, "available");
});

test("corrected checks are quiet, preserve later lineup and billing, while new names still need review", () => {
  const corrected = { ...current, city: "Ghimbav (Brașov)", startDate: "2027-07-26", endDate: "2027-07-30",
    status: "partial", ticketsUrl: url, ticketStatus: "available", lineup: [...artists, "Later Reviewed Act"] };
  const unchanged = evaluateCandidate(corrected, extract(fixture));
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(unchanged.reviewReasons, []);
  const billing = evaluateCandidate({ ...corrected, headliners: [artists[0]], lineup: corrected.lineup.slice(1) }, extract(fixture));
  assert.deepEqual(billing.changes, []);
  assert.deepEqual(billing.reviewReasons, []);
  const added = evaluateCandidate(corrected, extract(fixture.replace(artists.join(", "), [...artists, "Future Act"].join(", "))));
  assert.equal(added.publishable, false);
  assert.ok(added.reviewReasons.includes("Agent review required before lineup-triggered provider activity"));
  assert.deepEqual(added.changes.map(change => [change.kind, change.after]), [["artist_added", "Future Act"]]);
  const complete = evaluateCandidate({ ...corrected, status: "confirmed" }, extract(fixture));
  assert.deepEqual(complete.changes, []);
  assert.equal(complete.candidate.status, "confirmed");
  const semantic = extract(fixture);
  semantic.warnings.push("Independent provenance conflict");
  assert.deepEqual(evaluateCandidate(corrected, semantic).reviewReasons, ["Independent provenance conflict"]);
  const wrongEdition = evaluateCandidate({ ...corrected, editionYear: 2026 }, extract(fixture));
  assert.equal(wrongEdition.publishable, false);
  assert.ok(wrongEdition.reviewReasons.length);
});
