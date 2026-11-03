import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
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

const currentCapture=readFileSync(new URL('./fixtures/official-markup/rfp-current-20261103.html',import.meta.url),'utf8');
const reviewed=JSON.parse(readFileSync(new URL('./fixtures/official-markup/rfp-reviewed-20261103.json',import.meta.url),'utf8'));
const extractCurrent=(html=currentCapture)=>extractFestivalCandidate(html,getFestivalSource('rock-for-people'),'2026-11-03T17:47:21Z');
test('real November62-card partial announcement cannot remove the reviewed missing Neck Deep',()=>{
  const saved=structuredClone(reviewed),c=extractCurrent(),r=evaluateCandidate(saved,c);
  assert.equal(c.headliners.length,3);assert.equal(c.lineup.length,59);
  assert.ok(!c.lineup.includes('Neck Deep'));assert.equal(c.artistListMode,'additive');assert.equal(c.lineupScope,'announcement');assert.equal(c.status,'partial');
  assert.ok(!r.changes.some(x=>x.kind.endsWith('_removed')));
  assert.equal(r.changes.filter(x=>x.kind==='headliner_added').length,1);
  assert.equal(r.changes.filter(x=>x.kind==='artist_added').length,45);
  assert.equal(r.publishable,false);assert.deepEqual(r.reviewReasons,['Agent review required before lineup-triggered provider activity']);
  assert.deepEqual(saved,reviewed);assert.ok(saved.lineup.includes('Neck Deep'));
});
test('covered announcements are quiet even with omitted bookings; future names and billing remain reviewed',()=>{
  const c=extractCurrent();const full={...reviewed,headliners:c.headliners,lineup:[...c.lineup,'Neck Deep'],status:'confirmed'};
  const noop=evaluateCandidate(full,c);assert.deepEqual(noop.changes,[]);assert.deepEqual(noop.reviewReasons,[]);assert.equal(noop.publishable,false);
  const later=extractCurrent(currentCapture.replaceAll('Parkway Drive','Later Headliner').replaceAll('Evanescence','Later Artist'));
  const r=evaluateCandidate(full,later);assert.ok(!r.changes.some(x=>x.kind.endsWith('_removed')));assert.ok(r.changes.some(x=>x.after==='Later Headliner'));assert.ok(r.changes.some(x=>x.after==='Later Artist'));assert.equal(r.publishable,false);
  const promotion={...c,headliners:[...c.headliners,'Architects'],lineup:c.lineup.filter(x=>x!=='Architects')};
  assert.equal(evaluateCandidate(full,promotion).publishable,false);
});
test('partial card counts are dynamic, official origin is required and default removals stay reviewed',()=>{
  for(const count of [1,4,9]){
    const html=markup.slice(0,markup.indexOf('</a>')+4)+Array.from({length:count},(_,i)=>card('future-'+i,'Future Artist '+i,'UK')).join('');
    const c=extractCurrent(html);assert.equal(c.lineup.length,count);const r=evaluateCandidate(reviewed,c);assert.ok(!r.changes.some(x=>x.kind.endsWith('_removed')));assert.equal(r.publishable,false);
  }
  const invalid=extractCurrent(currentCapture.replaceAll('https://rockforpeople.cz/lineup/','https://foreign.example/lineup/'));assert.deepEqual(invalid.evidence,[]);
  const c=extractCurrent();delete c.artistListMode;delete c.lineupScope;
  const r=evaluateCandidate(reviewed,c);assert.ok(r.changes.some(x=>x.kind==='artist_removed'&&x.before==='Neck Deep'&&x.reviewRequired));assert.equal(r.publishable,false);
  assert.ok(evaluateCandidate(reviewed,extractCurrent(currentCapture.replaceAll('2027','2026'))).reviewReasons.some(x=>x.includes('does not match catalogue edition')));
});
