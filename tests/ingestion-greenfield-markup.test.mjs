import assert from "node:assert/strict";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const markup = `
  <div class="line-up-overline"><div class="small">10. – 12. Juni 2027</div></div>
  <ul class="headliner-list">
    <li><a href="https://greenfieldfestival.ch/line-up/parkway-drive" class="h1 artist-item">PARKWAY DRIVE</a></li>
    <li><a href="/line-up/evanescence" class="artist-item h1">EVANESCENCE</a></li>
    <li><a href="/line-up/billy-talent" class="h1 artist-item">BILLY TALENT</a></li>
  </ul>
  <ul class="line-up-list">
    <li><a href="/line-up/lorna-shore" class="h3 artist-item">LORNA SHORE</a></li>
    <li><a href="/line-up/dropkick-murphys" class="h3 artist-item">DROPKICK MURPHYS</a></li>
    <li><a href="/line-up/arch-enemy" class="h3 artist-item">ARCH ENEMY</a></li>
    <li><a href="/line-up/feine-sahne-fischfilet" class="h3 artist-item">FEINE SAHNE FISCHFILET</a></li>
    <li><a href="/line-up/enter-shikari" class="h3 artist-item">ENTER SHIKARI</a></li>
    <li><a href="/line-up/kreator" class="h3 artist-item">KREATOR</a></li>
    <li><a href="/line-up/feuerschwanz" class="h3 artist-item">FEUERSCHWANZ</a></li>
    <li><a href="/line-up/beartooth" class="h3 artist-item">BEARTOOTH</a></li>
    <li><a href="/line-up/the-interrupters" class="h3 artist-item">THE INTERRUPTERS</a></li>
    <li><a href="/line-up/eisbrecher" class="h3 artist-item">EISBRECHER</a></li>
    <li><a href="/line-up/sondaschule" class="h3 artist-item">SONDASCHULE</a></li>
    <li><a href="/line-up/fit-for-a-king" class="h3 artist-item">FIT FOR A KING</a></li>
    <li><a href="/line-up/danko-jones" class="h3 artist-item">DANKO JONES</a></li>
    <li><a href="/line-up/the-amity-affliction" class="h3 artist-item">THE AMITY AFFLICTION</a></li>
    <li><a href="/line-up/holding-absence" class="h3 artist-item">HOLDING ABSENCE</a></li>
    <li><a href="/line-up/speed" class="h3 artist-item">SPEED</a></li>
    <li><a href="/line-up/mittel-alta" class="h3 artist-item">MITTEL ALTA</a></li>
    <li><a href="/line-up/hot-milk" class="h3 artist-item">HOT MILK</a></li>
  </ul>
  <a href="/news/not-an-artist" class="h3">Not an artist</a>`;

test("Greenfield extracts the edition-matched 2027 lineup and billing tiers", () => {
  const source = getFestivalSource("greenfield");
  assert.deepEqual(source?.strategies, ["official_markup"]);
  assert.equal(source?.refreshPolicy, "daily");
  const candidate = extractFestivalCandidate(markup, source, "2026-09-29T11:11:00Z");
  assert.equal(candidate.startDate, "2027-06-10");
  assert.equal(candidate.endDate, "2027-06-12");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.headliners, ["Parkway Drive", "Evanescence", "Billy Talent"]);
  assert.deepEqual(candidate.lineup, [
    "Lorna Shore", "Dropkick Murphys", "Arch Enemy", "Feine Sahne Fischfilet",
    "Enter Shikari", "Kreator", "Feuerschwanz", "Beartooth", "The Interrupters",
    "Eisbrecher", "Sondaschule", "Fit for a King", "Danko Jones", "The Amity Affliction",
    "Holding Absence", "Speed", "Mittel Alta", "Hot Milk",
  ]);
  assert.equal(candidate.status, "partial");
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "headliners", "lineup", "status"]);
});

test("Greenfield fails closed without both official billing tiers", () => {
  const source = getFestivalSource("greenfield");
  const candidate = extractFestivalCandidate(markup.replaceAll("h1", "h2"), source, "2026-09-29T11:11:00Z");
  assert.deepEqual(candidate.evidence, []);
  assert.match(candidate.warnings[0], /found no trustworthy fields/);
});

test("Greenfield records a mismatched edition year for publication review", () => {
  const source = getFestivalSource("greenfield");
  const candidate = extractFestivalCandidate(markup.replaceAll("2027", "2026"), source, "2026-09-29T11:11:00Z");
  assert.deepEqual(candidate.observedEditionYears, [2026]);
});
