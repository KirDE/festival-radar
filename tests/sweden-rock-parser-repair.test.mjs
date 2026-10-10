import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const source = {festivalSlug:'sweden-rock',url:'https://swedenrock.com/',editionYear:2027,strategies:['json_ld_event','html_fallback'],refreshPolicy:'every_3_days',enabled:true};
const now='2026-10-10T16:27:00.000Z';
const fixtures=Object.fromEntries(['home','tickets'].map(name=>[name,readFileSync(new URL(`./fixtures/sweden-rock/${name}.html`,import.meta.url),'utf8')]));
const parse=(html,override={},at=now)=>extractFestivalCandidate(html,{...source,...override},at);
for(const name of ['home','tickets']) test(`actual corrected ${name}: official information URL and future sale, not Blind Bird sold-out`,()=>{
 const c=parse(fixtures[name]);assert.equal(c.ticketsUrl,'https://swedenrock.com/biljetter');assert.equal(c.ticketStatus,'unavailable');assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[2027]);
 for(const field of ['lineup','headliners','startDate','endDate','status'])assert.equal(c[field],undefined);
 const current={slug:'sweden-rock',editionYear:2027,startDate:'2027-06-09',endDate:'2027-06-12',lineup:['Verified support'],headliners:['Verified headline'],status:'partial',ticketsUrl:c.ticketsUrl,ticketStatus:c.ticketStatus};
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test('sponsor shop and language links cannot override official tickets',()=>{
 const bad='<a href="https://www.shop.duni.se" title="Duni"><img alt="Duni logo"></a><a href="/en/tickets">EN</a>';
 assert.equal(parse(bad+fixtures.home).ticketsUrl,'https://swedenrock.com/biljetter');assert.equal(parse(bad).ticketsUrl,undefined);assert.ok(parse(bad).warnings.length);
});
test('future official sale edits and subsequent edition need no frozen hash or date',()=>{
 const changed=fixtures.home.replaceAll('2027','2028').replace('23 oktober','15 november');
 const c=parse(changed,{editionYear:2028},'2027-11-01T10:00:00.000Z');assert.equal(c.ticketStatus,'unavailable');assert.deepEqual(c.observedEditionYears,[2028]);assert.deepEqual(c.warnings,[]);
 assert.equal(parse(changed).ticketsUrl,undefined);assert.ok(parse(changed).warnings.length);
});
test('passed sale timestamp does not invent availability; Stockholm boundary is exact',()=>{
 assert.equal(parse(fixtures.tickets,{},'2026-10-23T08:59:00.000Z').ticketStatus,'unavailable');
 const c=parse(fixtures.tickets,{},'2026-10-23T09:00:00.000Z');assert.equal(c.ticketStatus,undefined);assert.ok(c.warnings.length);
});
test('later explicit current sales or sellout override old Blind Bird and ignore unrelated sections',()=>{
 for(const [text,status] of [['Ordinarie biljetter finns att köpa','available'],['Festivalpass är slutsålda','sold_out']]){
 const html=fixtures.tickets.replace(/Ordinarie biljettsläpp:[^<]+/,text)+'<h2>Merch</h2>Festivalpass är slutsålda';
 const c=parse(html);assert.equal(c.ticketStatus,status);assert.deepEqual(c.warnings,[]);
 }
});
test('missing/invalid current summary keeps review, does not silently accept drift',()=>{
 for(const html of [fixtures.home.replace('BILJETTER 2027','MERCH 2027'),fixtures.home.replace('23 oktober','99 oktober'),fixtures.home.replace('11.00','99.99')]){
 const c=parse(html);assert.equal(c.ticketStatus,undefined);assert.ok(c.warnings.length);
 }
});

test("undated stale sale after year rollover is not reinterpreted as a new release",()=>{const c=parse(fixtures.home,{},"2027-01-01T10:00:00.000Z");assert.equal(c.ticketStatus,undefined);assert.ok(c.warnings.length);});
