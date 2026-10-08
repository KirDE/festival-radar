import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NOVA_CARD_DOCUMENT_MAX_BYTES, verifyNovaRockCardDocument } from "../lib/ingestion/novarock-card-observation.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";

const html = readFileSync(new URL("./fixtures/official-markup/novarock-lineup-2027.html", import.meta.url), "utf8");
const verify = (document = html, snapshot: unknown = novaContentFixture().snapshot) => verifyNovaRockCardDocument(Buffer.from(document), snapshot);
// Synthesized wrapper fixture: it is not the original official capture.
const fullPage = readFileSync(new URL("./fixtures/official-markup/novarock-lineup-2027-full-synthetic.html", import.meta.url), "utf8");
test("synthetic full-page wrappers retain exact card order and raw-byte hash", () => {
  const compact = verify();
  const full = verify(fullPage);
  assert.deepEqual(full.cards, compact.cards);
  assert.equal(full.authority, "NONE");
  assert.equal(full.rawDocumentSha256, createHash("sha256").update(Buffer.from(fullPage)).digest("hex"));
});
test("global copied/hidden cards, ambiguous identity and unsafe ancestry reject", () => {
  const card = fullPage.match(/<li class="artistCard[^]*?<\/li>/)![0];
  for (const altered of [
    fullPage.replace("<footer>", `<footer>${card}`),
    fullPage.replace("<footer>", '<div hidden>' + card + '</div><footer>'),
    fullPage.replace("<footer>", '<div class="eventCollection__items"></div><footer>'),
    fullPage.replace('<main class=', '<main style="display:none" class='),
    fullPage.replace('<div id="view">', '<div id="view" aria-hidden="true">'),
    fullPage.replace('<div id="view">', '<div id="view" onclick="hideCards()">'),
    fullPage.replace('<div id="view">', '<div id="view" class="visually-hidden">'),
    fullPage.replace('<main class="lineupArchive"', '<main class="lineupArchive visually-hidden"'),
    fullPage.replace('</head>', '<meta name="og:title" content="Nova Rock 2027"></head>'),
    fullPage.replace('</head>', '<script>artistCard 2027-06-09</script></head>'),
    fullPage.replace('</head>', '<script>console.log(1)</script></head>'),
    fullPage.replace('</head>', '<style>li{display:none}</style></head>'),
    fullPage.replace('<!-- Synthetic full-page wrapper test; NOT an official capture. -->', '<!-- artistCard copied here -->'),
    fullPage.replace('</div></div></body>', '</div></body>'),
  ]) assert.throws(() => verify(altered));
});

test("popover on main, viewport or final card fails closed", () => {
  const lastCard = fullPage.lastIndexOf('<li class="artistCard');
  assert.ok(lastCard > 0);
  const cardOpenEnd = fullPage.indexOf('>', lastCard);
  for (const altered of [
    fullPage.replace('<main class=', '<main popover="auto" class='),
    fullPage.replace('<div id="viewport">', '<div id="viewport" popover="auto">'),
    fullPage.slice(0, cardOpenEnd) + ' popover="manual"' + fullPage.slice(cardOpenEnd),
  ]) assert.throws(() => verify(altered), /hidden or executable attribute/);
});
test("canonical rel tokens and duplicates are checked document-wide", () => {
  const altered = [
    fullPage.replace('</head>', '<link rel="canonical alternate" href="https://www.novarock.at/lineup/2026/"></head>'),
    fullPage.replace('</head>', '<link rel=" alternate CANONICAL  " href="https://www.novarock.at/lineup/2026/"></head>'),
    fullPage.replace('<footer>', '<link rel="CANONICAL" href="https://www.novarock.at/lineup/2026/"><footer>'),
  ];
  for (const document of altered) assert.throws(() => verify(document), /canonical identity/);
  const caseOnly = fullPage.replace('rel="canonical"', 'rel="  CaNoNiCaL  "');
  assert.deepEqual(verify(caseOnly).cards, verify(fullPage).cards);
});

test("compensating per-card day swap rejects despite identical totals", () => {
  const swapped = fullPage.replace(/<li class="artistCard[^]*?<\/li>/g, (card) =>
    card.includes("/artist/die-toten-hosen/") ? card.replace("2027-06-09", "2027-06-10") :
    card.includes("/artist/the-smashing-pumpkins/") ? card.replace("2027-06-10", "2027-06-09") : card);
  assert.notEqual(swapped, fullPage);
  assert.throws(() => verify(swapped), /ordered day mutation/);
});

test("independent full-card verifier returns all 44 tuples, full byte hash and NONE", () => {
  const result = verify();
  assert.equal(result.authority, "NONE");
  assert.equal(result.status, "UNTRUSTED_DOCUMENT_VERIFIED_NON_AUTHORIZING");
  assert.equal(result.cards.length, 44);
  assert.deepEqual(result.dayCounts, [8, 14, 10, 12]);
  assert.deepEqual(result.cards[0], { caption: "Die Toten Hosen", officialUrl: "https://www.novarock.at/artist/die-toten-hosen/",
    day: "2027-06-09", billing: "HEADLINER", position: 0 });
  assert.deepEqual(result.cards[43], { caption: "Dame", officialUrl: "https://www.novarock.at/artist/dame/",
    day: "2027-06-12", billing: "LINEUP", position: 39 });
  assert.equal(result.rawDocumentSha256, createHash("sha256").update(Buffer.from(html)).digest("hex"));
  assert.equal(result.rawDocumentBytes, Buffer.byteLength(html));
  assert.ok(result.cards.every((c) => !Object.hasOwn(c, "artistId")));
  assert.deepEqual(verify(), result);
});
test("hash covers unrelated bytes; late URL is observed without identity inference", () => {
  const original = verify();
  const comment = verify(html.replace("</head>", "<!-- unrelated raw bytes --></head>"));
  assert.notEqual(comment.rawDocumentSha256, original.rawDocumentSha256);
  assert.deepEqual(comment.cards, original.cards);
  const changed = verify(html.replace("/artist/dame/", "/artist/different-official-slug/"));
  assert.notEqual(changed.rawDocumentSha256, original.rawDocumentSha256);
  assert.equal(changed.cards[43].officialUrl, "https://www.novarock.at/artist/different-official-slug/");
});
const lateCard = (s: string, mutate: (card: string) => string) => s.replace(/<li\b[^]*?<\/li>/g,
  (card) => card.includes("/artist/dame/") ? mutate(card) : card);
const cases: [string, (s: string) => string][] = [
  ["later caption", (s) => s.replace(">Dame<", ">Other Artist<")],
  ["later day count", (s) => lateCard(s, (c) => c.replace('data-filter-day="2027-06-12"', 'data-filter-day="2027-06-09"'))],
  ["later billing", (s) => lateCard(s, (c) => c.replace("--support", "--headliner"))],
  ["duplicate URL", (s) => s.replace("/artist/dame/", "/artist/die-toten-hosen/")],
  ["foreign URL", (s) => s.replace("https://www.novarock.at/artist/dame/", "https://evil.invalid/artist/dame/")],
  ["credentials", (s) => s.replace("https://www.novarock.at/artist/dame/", "https://user@www.novarock.at/artist/dame/")],
  ["query URL", (s) => s.replace("/artist/dame/", "/artist/dame/?x=1")],
  ["incomplete", (s) => s.slice(0, -10)],
  ["nested card", (s) => s.replace('<h2 class="artistCard__title">Dame</h2>', '<h2 class="artistCard__title"><li>Dame</li></h2>')],
  ["duplicate attribute", (s) => s.replace('data-filter-day="2027-06-09"', 'data-filter-day="2027-06-09" data-filter-day="2027-06-10"')],
  ["hidden", (s) => s.replace('<main class=', '<main hidden class=')],
  ["styled", (s) => s.replace('<main class=', '<main style="display:none" class=')],
  ["sidebar main", (s) => s.replace("<main", "<aside><main").replace("</main>", "</main></aside>")],
  ["script claims", (s) => s.replace("</head>", '<script type="application/json">{}</script></head>')],
  ["wrong year", (s) => s.replaceAll("2027", "2026")],
  ["unknown entity", (s) => s.replace(">Dame<", ">D&unknown;ame<")],
  ["duplicate metadata", (s) => s.replace("</head>", '<meta name="og:title" content="Nova Rock 2027"></head>')],
  ["extra card", (s) => s.replace("</ul>", s.match(/<li[^]*?<\/li>/)![0] + "</ul>")],
  ["missing card", (s) => s.replace(/<li[^]*?<\/li>/, "")],
];
for (const [label, mutate] of cases) test(`rejects ${label}`, () => assert.throws(() => verify(mutate(html))));
test("byte/depth bounds and malformed UTF-8 fail before accepting evidence", () => {
  const snapshot = novaContentFixture().snapshot;
  for (const bytes of [new Uint8Array(), new Uint8Array(NOVA_CARD_DOCUMENT_MAX_BYTES + 1), Uint8Array.of(0xff)]) {
    assert.throws(() => verifyNovaRockCardDocument(bytes, snapshot));
  }
  assert.throws(() => verify(html.replace("</head>", `${"<div>".repeat(66)}${"</div>".repeat(66)}</head>`)));
});
test("sealed ordered bill and complete content integrity must agree", () => {
  const snapshot = novaContentFixture().snapshot;
  snapshot.candidate.normalized.lineup!.reverse();
  assert.throws(() => verify(html, snapshot));
});
test("modules expose no transport, provider, publisher or production entrypoint", () => {
  const code = readFileSync(new URL("../lib/ingestion/novarock-card-observation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(|from ["'][^"']*(?:adapters|spotify|publisher|publication|fetch|run)\b/);
});
