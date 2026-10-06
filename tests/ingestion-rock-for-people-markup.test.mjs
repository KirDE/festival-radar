import assert from "node:assert/strict";
import { test } from "node:test";
import { parserSource as getFestivalSource } from "./support/parser-source.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const card = (slug, name, country, tier = "white") => `
  <a href="https://rockforpeople.cz/lineup/${slug}/" class="card card--lineup ${tier}" rel="bookmark">
    <div class="card__section"><h3>${name} <sup>${country}</sup></h3></div>
  </a>`;

const markup = `
  <img src="https://rockforpeople.cz/wp-content/themes/rfp/assets/img/date-topbar-2027.svg" alt="Rock for People 2027 datum">
  ${card("blink-182", "blink-182", "US", "yellow")}
  ${card("faith-no-more", "Faith No More", "US", "yellow")}
  ${card("architects", "Architects", "UK")}
  ${card("billy-talent", "Billy Talent", "CA")}
  ${card("killswitch-engage", "Killswitch Engage", "US")}
  ${card("motionless-in-white-2", "Motionless In White", "US")}
  ${card("napalm-death", "Napalm Death", "UK")}
  ${card("neck-deep", "Neck Deep", "UK")}
  ${card("beach-bunny", "Beach Bunny", "US")}
  ${card("blue-medusa", "Blue Medusa", "CA/US")}
  ${card("fat-dog", "Fat Dog", "UK")}
  ${card("from-ashes-to-new", "From Ashes To New", "US")}
  ${card("guilt-trip", "Guilt Trip", "UK")}
  ${card("holding-absence", "Holding Absence", "UK")}
  ${card("sleeping-with-sirens", "Sleeping With Sirens", "US")}
  ${card("static-x-2", "Static-X", "US")}
  ${card("wage-war", "Wage War", "US")}
  <a href="/lineup/ignored/" class="menu-item">Lineup</a>`;

test("Rock for People extracts the edition-matched lineup and official billing tiers", () => {
  const source = getFestivalSource("rock-for-people");
  const candidate = extractFestivalCandidate(markup, source, "2026-09-30T08:40:00Z");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.deepEqual(candidate.headliners, ["blink-182", "Faith No More"]);
  assert.deepEqual(candidate.lineup, [
    "Architects", "Billy Talent", "Killswitch Engage", "Motionless In White", "Napalm Death",
    "Neck Deep", "Beach Bunny", "Blue Medusa", "Fat Dog", "From Ashes To New", "Guilt Trip",
    "Holding Absence", "Sleeping With Sirens", "Static-X", "Wage War",
  ]);
  assert.equal(candidate.status, "partial");
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["headliners", "lineup", "status"]);
});

test("Rock for People fails closed without an edition marker and both billing tiers", () => {
  const source = getFestivalSource("rock-for-people");
  for (const invalid of [markup.replaceAll("2027", "current"), markup.replaceAll("yellow", "white")]) {
    const candidate = extractFestivalCandidate(invalid, source, "2026-09-30T08:40:00Z");
    assert.deepEqual(candidate.evidence, []);
    assert.match(candidate.warnings[0], /found no trustworthy fields/);
  }
});

test("Rock for People records a mismatched edition marker for publication review", () => {
  const source = getFestivalSource("rock-for-people");
  const candidate = extractFestivalCandidate(markup.replaceAll("2027", "2026"), source, "2026-09-30T08:40:00Z");
  assert.deepEqual(candidate.observedEditionYears, [2026]);
});
