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
  assert.equal(candidate.status, undefined); // no claim of complete lineup
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "city", "lineup"]);
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

test("old edition, wrong heading, dates, location and rename prose fail closed", () => {
  noEvidence(fixture.replaceAll("2027", "2026").replaceAll("'27", "'26").replaceAll("&#039;27", "&#039;26"));
  for (const [before, after] of [["<h1>Rockstadt Fest 2027</h1>", "<h1>Rockstadt Fest 2026</h1>"], ["26-30 iulie '27", "26-30 iulie '26"], ["26-30 iulie '27", "25-30 iulie '27"], ["26-30 iulie '27", "26-31 iulie '27"], ["26-30 iulie '27", "26-30 august '27"], ["<strong>Rockstadt Fest, Ghimbav (Brașov)</strong>", "<strong>Rockstadt Fest, Râșnov</strong>"], ["Starting with the 2027 edition", "Starting with the 2026 edition"], ["we become Rockstadt Festival.", "we become Rockstadt Extreme Fest."], ["What started as Rockstadt Extreme Fest", "What started as Another Festival"]]) noEvidence(fixture.replace(before, after));
});

test("missing, additional, duplicate or altered artist identities and announcements fail closed", () => {
  for (const artist of artists) noEvidence(fixture.replace(artists.join(", "), artists.filter((name) => name !== artist).join(", ")));
  for (const replacement of [artists.join(", ") + ", Extra Artist", artists.join(", ") + ", Overkill", artists.join(", ").replace("Mgla", "Mgła"), artists.join(", ").replace("Slash featuring Myles Kennedy and The Conspirators", "Slash"), artists.join(", ").replace("Venom", "<em>Venom</em>")]) noEvidence(fixture.replace(artists.join(", "), replacement));
  noEvidence(fixture.replace(announcement, announcement + "<br>" + announcement));
  noEvidence(fixture.replace(desc, desc + desc));
  noEvidence(fixture.replace(announcement, "Extra Artist<br>" + announcement));
  noEvidence(fixture.replace(announcement, announcement + "<br>Also confirmed: Extra Artist"));
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
