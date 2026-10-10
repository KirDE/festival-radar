import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const fixture = readFileSync(new URL('./fixtures/resurrection-ticket-placeholder.html', import.meta.url), 'utf8');
const source = { festivalSlug:'resurrection-fest',url:'https://www.resurrectionfest.es/',strategies:['json_ld_event','html_fallback'],editionYear:2027,refreshPolicy:'daily',enabled:true };
const parse = (html, overrides={}) => extractFestivalCandidate(html,{...source,...overrides},'2026-10-10T15:44:00Z');

test('real correction: Spanish cross-month dates; early-bird banner is not an artist or event sellout',()=>{
  const c=parse(fixture);
  assert.equal(c.startDate,'2027-06-30'); assert.equal(c.endDate,'2027-07-03');
  assert.equal(c.ticketsUrl,'https://www.resurrectionfest.es/entradas/');
  for(const field of ['lineup','headliners','status','ticketStatus'])assert.equal(c[field],undefined);
  assert.deepEqual(c.observedEditionYears,[2027]);assert.deepEqual(c.warnings,[]);
  const current={slug:source.festivalSlug,editionYear:2027,startDate:c.startDate,endDate:c.endDate,ticketsUrl:c.ticketsUrl,ticketStatus:'unknown',status:'tba',lineup:[],headliners:[]};
  const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});

test('future individual artists work without an edition-specific bill or document hash; news tours excluded',()=>{
  const h=fixture.replace('2027. 30 JUNIO - 3 DE JULIO DE 2027','2028. 28 JUNIO – 1 DE JULIO DE 2028').replace(/<h3 class="h-l">[\s\S]*?<\/h3>/,'<div data-artist="Future Band">Future Band</div><span itemprop="performer">Next Band</span>')+'<article><div data-artist="Route Tour Only">Route Tour Only</div></article>';
  const c=parse(h,{editionYear:2028});assert.equal(c.startDate,'2028-06-28');assert.equal(c.endDate,'2028-07-01');assert.deepEqual(c.lineup,['Future Band','Next Band']);assert.equal(c.ticketStatus,undefined);assert.equal(c.status,undefined);assert.deepEqual(c.warnings,[]);
});

test('stale SEO and Route tour dates cannot replace the festival heading',()=>{
  const c=parse('<meta name="description" content="1, 2, 3 y 4 de julio de 2026"><h3>Route Resurrection 2027. 7 ABRIL - 9 DE ABRIL DE 2027</h3>'+fixture);
  assert.equal(c.startDate,'2027-06-30');assert.deepEqual(c.observedEditionYears,[2027]);
});

test('archived edition, invalid or conflicting ranges refuse current festival fields',()=>{
  for(const h of [fixture.replaceAll('2027','2026'),fixture.replace('30 JUNIO','31 JUNIO'),fixture+'<h3>Resurrection Fest EG 2027. 29 JUNIO - 3 DE JULIO DE 2027</h3>']){
    const c=parse(h);assert.equal(c.startDate,undefined);assert.equal(c.lineup,undefined);assert.equal(c.ticketsUrl,undefined);assert.ok(c.warnings.length);
  }
});

test('unknown lineup poster is reviewable and never overwrites a verified partial bill',()=>{
  const c=parse(fixture.replace('EARLY BIRD TICKETS SOLD OUT','FIRST BANDS ANNOUNCED'));
  assert.equal(c.lineup,undefined);assert.equal(c.headliners,undefined);assert.equal(c.status,undefined);assert.match(c.warnings.join(' '),/image requires review/);
});


test('a later artist poster still requires review even if the early-bird heading remains',()=>{
  const c=parse(fixture.replaceAll('RF26-Early-Birds-Tickets-Sold-Out','RF27-First-Artists'));
  assert.equal(c.lineup,undefined);assert.match(c.warnings.join(' '),/image requires review/);
});

test('invalid links do not break a valid extraction or masquerade as festival tickets',()=>{
  const c=parse('<a href="https://[invalid">Tickets</a>'+fixture);
  assert.equal(c.ticketsUrl,'https://www.resurrectionfest.es/entradas/');assert.deepEqual(c.warnings,[]);
});
