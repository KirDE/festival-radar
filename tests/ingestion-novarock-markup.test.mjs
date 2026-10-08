import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { sourceParserKey } from "../lib/sources/repository.ts";
import { parserSource } from "./support/parser-source.ts";

const url = "https://www.novarock.at/lineup/";
const canonical = "https://www.novarock.at/event/nova-rock-2027-pannonia-fields-2027-06-09/";
const at = "2026-10-08T00:00:00Z";
const fixture = await readFile(new URL("./fixtures/official-markup/novarock-lineup-2027.html", import.meta.url), "utf8");
const source = (overrides = {}) => parserSource("nova-rock", { url, ...overrides });
const extract = (html, overrides) => extractFestivalCandidate(html, source(overrides), at);
const current = { slug: "nova-rock", editionYear: 2027, startDate: "2027-06-10", endDate: "2027-06-12", headliners: ["Die Ärzte", "Motionless In White"], lineup: ["TBS"] };
const card = (name, slug, day, billing = "support") => `<li class="artistCard artistCollection__artist artistCollection__artist--${billing}" data-filter-day="2027-06-${day}"><a href="https://www.novarock.at/artist/${slug}/"><figure class="artistCard__image"><picture><img src="/inert.jpg"></picture></figure><div class="artistCard__content"><h2 class="artistCard__title">${name}</h2><div class="artistCard__meta"></div></div></a></li>`;
const cards = Array.from({ length: 44 }, (_, i) => card(`Artist ${i}`, `artist-${i}`, String(9 + i % 4).padStart(2, "0"), i < 4 ? "headliner" : "support"));
const synthetic = `<!doctype html><html><head><title>Line-Up 2027 - Nova Rock Festival</title><link rel="canonical" href="${canonical}"><meta name="og:url" content="${canonical}"><meta name="og:title" content="Nova Rock 2027"><meta name="og:type" content="article"></head><body><main class="lineupArchive"><header class="lineupArchive__header"><h1>Line-Up 2027</h1></header><section class="lineupArchive__content"><ul class="eventCollection__items">${cards.join("")}</ul></section></main></body></html>`;
function rejected(html, overrides) {
  const candidate = extract(html, overrides);
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.observedEditionYears, []);
  for (const field of ["startDate", "endDate", "headliners", "lineup", "status"]) assert.equal(candidate[field], undefined);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.length);
  assert.deepEqual(result.changes, []);
}

test("reviewed current-edition official cards yield four explicitly billed headliners and 40 support acts", () => {
  assert.equal(sourceParserKey(source()), "official_markup:nova-rock");
  const candidate = extract(fixture);
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.startDate, "2027-06-09");
  assert.equal(candidate.endDate, "2027-06-12");
  assert.deepEqual(candidate.headliners, ["Die Toten Hosen", "The Smashing Pumpkins", "Faith No More", "Die Ärzte"]);
  assert.equal(candidate.lineup.length, 40);
  for (const name of ["Motionless In White", "TBS", "Slash feat. Myles Kennedy & The Conspirators", "Dexter & The Moonrocks"]) assert.ok(candidate.lineup.includes(name));
  assert.ok(!candidate.lineup.includes("The Butcher Sisters")); // alias needs independent identity review
  assert.ok(!candidate.lineup.includes("Slash featuring Myles Kennedy and The Conspirators"));
  assert.ok(!candidate.headliners.includes("Amon Amarth")); // support explicitly, not inferred from fame
  assert.equal(candidate.status, undefined); // no complete-lineup claim
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "headliners", "lineup"]);
  assert.ok(candidate.evidence.every((e) => e.sourceUrl === url && e.observedAt === at && e.excerpt.includes(canonical) && e.excerpt.includes('data-filter-day="2027-06-09"') && e.excerpt.length <= 500));
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.includes("Agent review required before lineup-triggered provider activity"));
  assert.ok(result.changes.some((c) => c.kind === "date_changed" && c.before === "2027-06-10" && c.after === "2027-06-09" && c.reviewRequired));
  assert.ok(result.changes.some((c) => c.kind === "headliner_removed" && c.before === "Motionless In White" && c.reviewRequired));
  assert.ok(result.changes.some((c) => c.kind === "artist_added" && c.after === "Motionless In White"));
  assert.deepEqual(result.reviewReasons.sort(), ["Agent review required before lineup-triggered provider activity", "Removals require confirmation", "date_changed requires review"].sort());
});

test("synthetic current cards produce REVIEW even with unchanged dates and only additions", () => {
  const candidate = extract(synthetic);
  assert.equal(candidate.headliners.length, 4);
  assert.equal(candidate.lineup.length, 40);
  const result = evaluateCandidate({ ...current, startDate: candidate.startDate, headliners: [], lineup: [] }, candidate);
  assert.ok(result.changes.length);
  assert.ok(result.changes.every((c) => !c.reviewRequired));
  assert.equal(result.publishable, false);
  assert.ok(result.reviewReasons.some((reason) => /provider activity/.test(reason)));
});

test("exact URL/year and direct fetch are mandatory; manual source activation stays inert", () => {
  for (const sourceUrl of [url.slice(0, -1), url + "?year=2027", url + "#lineup", url.replace("https:", "http:"), url.replace("www.", ""), canonical, "https://www.novarock.at/", "https://www.novarock.at/news/2-line-up-phase/"]) rejected(fixture, { url: sourceUrl });
  for (const editionYear of [2026, 2028, undefined]) rejected(fixture, { editionYear });
  rejected(fixture, { fetchUrl: canonical });
  rejected(fixture, { followLinkPattern: "^/lineup/$" });
  rejected(fixture, { strategies: ["manual_review"] });
});

test("missing, duplicate, relocated or inconsistent identity and year fail closed", () => {
  for (const pattern of [/<title>.*?<\/title>/, /<link rel="canonical"[^>]*>/, /<h1>.*?<\/h1>/]) {
    const tag = synthetic.match(pattern)[0];
    rejected(synthetic.replace(tag, ""));
    rejected(synthetic.replace(tag, tag + tag));
  }
  for (const [before, after] of [[canonical, url], ["Line-Up 2027 - Nova Rock Festival", "Line-Up 2026 - Nova Rock Festival"], ["<h1>Line-Up 2027", "<h1>Line-Up 2026"], ['class="lineupArchive"', 'class="archive2026"'], ['class="lineupArchive__content"', 'class="sidebar"'], ['class="eventCollection__items"', 'class="oldGrid"']]) rejected(synthetic.replace(before, after));
  for (const key of ["og:url", "og:title", "og:type"]) {
    const tag = synthetic.match(new RegExp(`<meta name="${key}"[^>]*>`))[0];
    rejected(synthetic.replace(tag, ""));
    rejected(synthetic.replace(tag, tag + tag));
    rejected(synthetic.replace(tag, tag.replace('content="', 'content="wrong ')));
  }
  rejected(synthetic.replaceAll("2027", "2026"));
  const identity = synthetic.match(/<link rel="canonical"[^>]*>/)[0];
  rejected(synthetic.replace(identity, "").replace("</body>", identity + "</body>"));
  rejected(synthetic.replace(identity, `<script>${identity}</script>`));
});

test("2026 sidebar, script, footer and old announcement decoys cannot expand or replace main evidence", () => {
  const decoy = `<aside>${card("Old Artist", "old", "09").replaceAll("2027", "2026")}</aside><footer>10–12 June 2027</footer><script>${cards[0]}</script>`;
  assert.deepEqual(extract(synthetic.replace("<body>", "<body>" + decoy)).lineup, extract(synthetic).lineup);
  const main = synthetic.match(/<main.*?<\/main>/s)[0];
  for (const wrapper of ["aside", "nav", "footer", "template", "script"]) rejected(synthetic.replace(main, `<${wrapper}>${main}</${wrapper}>`));
  rejected(synthetic.replace(cards[0], cards[0].replace("2027", "2026")));
});

test("missing, ambiguous, duplicate, hidden, malformed or drifted cards never provide partial evidence", () => {
  for (const [before, after] of [['data-filter-day="2027-06-09"', 'data-filter-day="2027-06-13"'], ['data-filter-day="2027-06-09"', ''], ['artistCollection__artist--headliner', 'artistCollection__artist--unknown'], ['artistCollection__artist--headliner', 'artistCollection__artist--headliner artistCollection__artist--support'], ['class="artistCard__title"', 'class="changedTitle"'], ['<h2 class="artistCard__title">Artist 0</h2>', '<h2 class="artistCard__title"><span>Artist 0</span></h2>'], ['https://www.novarock.at/artist/artist-0/', 'https://evil.test/artist/artist-0/'], ['class="artistCard artistCollection__artist', 'hidden class="artistCard artistCollection__artist'], ['data-filter-day="2027-06-09"', 'data-filter-day="2027-06-09" data-filter-day="2026-06-09"']]) rejected(synthetic.replace(before, after));
  for (const replacement of [cards[1], cards[0] + cards[0], cards[0].replace("</li>", ""), cards[0].replace("</a>", ""), cards[0].replace("</figure>", ""), cards[0].replace("</a>", "<p>Extra Artist</p></a>"), cards[0].replace("Artist 0", "Artist &#99999999;"), cards[0].replace("<li ", "<li style='display:none' ")]) rejected(synthetic.replace(cards[0], replacement));
  rejected(synthetic.replace(cards[1], cards[1].replace("Artist 1", "Artist 0"))); // duplicate across billing
  rejected(synthetic.replace(cards[1], cards[1].replace("artist-1/", "artist-0/")));
  for (const ending of ["</ul>", "</section>", "</main>", "</body>", "</html>"]) rejected(synthetic.replace(ending, ""));
  rejected(synthetic.slice(0, synthetic.indexOf(cards[30])));
});

test("partial snapshots cannot mass-remove; valid smaller proposals above the floor remain reviewed", () => {
  rejected(synthetic.replace(cards[43], ""));
  rejected(synthetic.replace(cards.join(""), cards.slice(0, 4).join("")));
  const candidate = extract(synthetic);
  const result = evaluateCandidate({ ...current, headliners: candidate.headliners, lineup: [...candidate.lineup, "Removed Artist"] }, candidate);
  assert.equal(result.publishable, false);
  assert.ok(result.changes.some((c) => c.kind === "artist_removed" && c.before === "Removed Artist" && c.reviewRequired));
  rejected(synthetic.replaceAll('data-filter-day="2027-06-09"', 'data-filter-day="2027-06-10"'));
});
