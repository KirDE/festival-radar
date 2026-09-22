import assert from "node:assert/strict";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const markup = `
  <p data-variant="header1">FØRSTE ARTISTER TIL TONS OF ROCK 2027 ER KLARE!</p>
  <p>Vi er i gang! De første 17 artistene til Tons of Rock 2027 er klare.</p>
  <p>Her er alle artistene for årets første slipp: </p>
  <p>Mötley Crüe<br>Judas Priest<br>Turnstile<br>Lynyrd Skynyrd<br>Helloween<br>Amon Amarth<br>Satyricon<br>Kreator<br>Motionless in white<br>I Prevail<br>OnklP &amp; De Fjerne Slektningene<br>Seigmen<br>Watain<br>Gåte<br>GWAR<br>Blue Medusa<br>Neckbreakker</p>
  <p>Vi sees på sletta, 23-26. juni 2027!</p>`;

test("Tons of Rock extracts the edition-matched official announcement", () => {
  const source = getFestivalSource("tons-of-rock");
  assert.deepEqual(source?.strategies, ["official_markup"]);
  assert.equal(source?.refreshPolicy, "daily");
  assert.equal(source?.followLinkPattern, "^/news/2027slipp\\d+/?$");
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
