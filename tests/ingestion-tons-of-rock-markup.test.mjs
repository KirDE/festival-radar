import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { parserSource as getFestivalSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const markup = `
  <p data-variant="header1">FØRSTE ARTISTER TIL TONS OF ROCK 2027 ER KLARE!</p>
  <p>Vi er i gang! De første 17 artistene til Tons of Rock 2027 er klare.</p>
  <p>Her er alle artistene for årets første slipp: </p>
  <p>Mötley Crüe<br>Judas Priest<br>Turnstile<br>Lynyrd Skynyrd<br>Helloween<br>Amon Amarth<br>Satyricon<br>Kreator<br>Motionless in white<br>I Prevail<br>OnklP &amp; De Fjerne Slektningene<br>Seigmen<br>Watain<br>Gåte<br>GWAR<br>Blue Medusa<br>Neckbreakker</p>
  <p>Vi sees på sletta, 23-26. juni 2027!</p>`;

test("Tons of Rock extracts the edition-matched official announcement", () => {
  const source = getFestivalSource("tons-of-rock");
  const candidate = extractFestivalCandidate(markup, source, "2026-09-22T13:55:00Z");
  assert.equal(candidate.startDate, "2027-06-23");
  assert.equal(candidate.endDate, "2027-06-26");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.headliners, undefined);
  assert.equal(candidate.lineup?.length, 17);
  assert.deepEqual(candidate.lineup?.slice(0, 5), ["Mötley Crüe", "Judas Priest", "Turnstile", "Lynyrd Skynyrd", "Helloween"]);
  assert.equal(candidate.lineup?.at(-1), "Neckbreakker");
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "lineup"]);
});

test("Tons of Rock fails closed when the stated artist count does not match", () => {
  const source = getFestivalSource("tons-of-rock");
  const candidate = extractFestivalCandidate(markup.replace("første 17 artistene", "første 18 artistene"), source, "2026-09-22T13:55:00Z");
  assert.deepEqual(candidate.evidence, []);
  assert.match(candidate.warnings[0], /found no trustworthy fields/);
});

const dayBill = await readFile(new URL("./fixtures/tons-of-rock-second-announcement.html", import.meta.url), "utf8");
const daySource = getFestivalSource("tons-of-rock", { url: "https://www.tonsofrock.no/news/2027slipp2" });
const parseDayBill = (html = dayBill, source = daySource) => extractFestivalCandidate(html, source, "2026-10-20T16:07:19Z");

test("Tons of Rock second announcement extracts the complete provisional day bill, not only 14 new acts", () => {
  const c = parseDayBill();
  assert.equal(c.lineup?.length, 31);
  assert.equal(c.startDate, "2027-06-23");
  assert.equal(c.endDate, "2027-06-26");
  assert.equal(c.status, "partial");
  assert.equal(c.artistListMode, "additive");
  assert.equal(c.lineupScope, "announcement");
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  assert.ok(c.lineup.includes("MÖTLEY CRÜE"));
  assert.ok(c.lineup.includes("FAITH NO MORE"));
  assert.ok(c.lineup.includes("SLASH FEATURING MYLES KENNEDY AND THE CONSPIRATORS"));
  assert.ok(c.lineup.includes("ONKLP & DE FJERNE SLEKTNINGENE"));
  assert.equal(c.headliners, undefined);
  assert.equal(c.ticketsUrl, undefined);
  assert.equal(c.ticketStatus, undefined);
});

test("Tons of Rock supports later artist additions and later editions without a fixed bill or document hash", () => {
  const c = parseDayBill(dayBill.replace("|| NECKBREAKKER", "|| NECKBREAKKER || NEW BAND"));
  assert.equal(c.lineup?.length, 32);
  assert.ok(c.lineup.includes("NEW BAND"));
  const next = parseDayBill(dayBill.replaceAll("2027", "2038"), { ...daySource, editionYear: 2038 });
  assert.equal(next.startDate, "2038-06-23");
  assert.equal(next.lineup?.length, 31);
});

for (const [label, transform] of [
  ["wrong edition", h => h.replaceAll("2027", "2026")],
  ["duplicate day", h => h.replace("TORSDAG 24. JUNI", "ONSDAG 23. JUNI")],
  ["weekday mismatch", h => h.replace("ONSDAG 23. JUNI", "MANDAG 23. JUNI")],
  ["missing intermediate day", h => h.replace(/<p><strong>TORSDAG[\s\S]*?<\/p>/, "")],
  ["duplicate artist", h => h.replace("|| NECKBREAKKER", "|| MÖTLEY CRÜE")],
  ["empty artist cell", h => h.replace("|| NECKBREAKKER", "||")],
  ["missing provisional heading", h => h.replace("FORELØPIG BEKREFTET", "BEKREFTET")],
  ["missing list terminator", h => h.replace("…og mange flere kommer!", "")],
  ["script-only bill", h => `<main><script>${h}</script></main>`],
  ["footer-only bill", h => h.replaceAll("main>", "footer>")],
  ["wrong edition with archived first announcement", h => h.replaceAll("2027", "2026") + markup],
  ["missing day with archived first announcement", h => h.replace(/<p><strong>TORSDAG[\s\S]*?<\/p>/, "") + markup],
]) {
  test(`Tons of Rock day bill fails closed for ${label}`, () => {
    const c = parseDayBill(transform(dayBill));
    assert.equal(c.lineup, undefined);
    assert.deepEqual(c.evidence, []);
  });
}

test("Tons of Rock ignores navigation, scripts and marketing descriptions outside the scoped bill", () => {
  const c = parseDayBill(`<nav>UNRELATED BAND</nav><script>ARCHIVE 2026</script>${dayBill}<footer>UNRELATED BAND</footer>`);
  assert.equal(c.lineup?.length, 31);
  assert.ok(!c.lineup.includes("UNRELATED BAND"));
});

test("Tons of Rock additions cannot automatically publish or enqueue provider work", () => {
  const current = { slug: "tons-of-rock", editionYear: 2027, startDate: "2027-06-23", endDate: "2027-06-26",
    status: "partial", ticketStatus: "unknown", headliners: [],
    lineup: extractFestivalCandidate(markup, daySource, "2026-09-22T13:55:00Z").lineup };
  const c = parseDayBill();
  const result = evaluateCandidate(current, c);
  assert.equal(result.changes.filter(change => change.kind === "artist_added").length, 14);
  assert.equal(result.publishable, false);
  assert.deepEqual(result.reviewReasons, ["Agent review required before lineup-triggered provider activity"]);
  assert.ok(!result.changes.some(change => change.kind.endsWith("_removed")));
  const accepted = { ...current, status: "confirmed", lineup: [...c.lineup, "Previously verified artist"], headliners: ["MÖTLEY CRÜE"] };
  const unchanged = evaluateCandidate(accepted, c);
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(unchanged.reviewReasons, []);
  const later = evaluateCandidate(accepted, parseDayBill(dayBill.replace("|| NECKBREAKKER", "|| NECKBREAKKER || NEW BAND")));
  assert.equal(later.publishable, false);
  assert.ok(later.reviewReasons.includes("Agent review required before lineup-triggered provider activity"));
});
