import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {parserSource} from './support/parser-source.ts';
const html=await readFile(new URL('./fixtures/ingestion/bloodstock-2027-stages.html',import.meta.url),'utf8');
const corrected=JSON.parse(await readFile(new URL('./fixtures/ingestion/bloodstock-2027-corrected.json',import.meta.url),'utf8'));
const source=parserSource('bloodstock',{url:'https://www.bloodstock.uk.com/',followLinkPattern:'^/events/boa-2027/stages/?$'});
const extract=(doc=html,config=source)=>extractFestivalCandidate(doc,config,'2026-10-10T14:00:00.000Z');
const set=names=>names.map(name=>name.toLowerCase()).sort();
const current={slug:'bloodstock',editionYear:2027,city:'Walton-on-Trent',startDate:'2027-08-05',endDate:'2027-08-08',...corrected};
test('real correction: all 45 current artists, main-stage-only billing, partial not complete',()=>{
 const c=extract();assert.deepEqual(set(c.headliners),set(corrected.headliners));assert.deepEqual(set(c.lineup),set(corrected.lineup));assert.equal(c.lineup.length,42);assert.equal(c.status,'partial');assert.equal(c.startDate,'2027-08-05');assert.equal(c.endDate,'2027-08-08');assert.equal(c.ticketsUrl,undefined);assert.equal(c.ticketStatus,undefined);assert.deepEqual(c.warnings,[]);
 assert.deepEqual(evaluateCandidate(current,c).changes,[]);assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);
});
test('future announcements are discovered without a bill or hash allowlist; deletions require review',()=>{
 const extra='<a href="/events/boa-2027/bands/later-act"><img alt="Band Logo for LATER ACT"></a>';
 const c=extract(html.replace('<dt>Friday 6th</dt>',extra+'<dt>Friday 6th</dt>'));assert.ok(c.lineup.includes('LATER ACT'));assert.ok(evaluateCandidate(current,c).changes.some(x=>x.after==='LATER ACT'));
 const removed=extract(html.replace(/<a href="\/events\/boa-2027\/bands\/acid-bath">[^]*?<\/a>/,''));assert.ok(evaluateCandidate(current,removed).reviewReasons.includes('Removals require confirmation'));
});
test('archived bands, external links, scripts and Sophie headliner CSS cannot alter main billing',()=>{
 const c=extract(html.replace('<dt>Friday 6th</dt>','<a href="/events/boa-2026/bands/old"><img alt="Band Logo for OLD"></a><a href="https://evil.test/events/boa-2027/bands/foreign"><img alt="Band Logo for FOREIGN"></a><script><a href="/events/boa-2027/bands/script"><img alt="Band Logo for SCRIPT"></a></script><dt>Friday 6th</dt>'));
 assert.deepEqual(set(c.headliners),set(corrected.headliners));assert.deepEqual(set(c.lineup),set(corrected.lineup));
});
test('wrong edition or missing stage structure is not treated as successful extraction',()=>{
 assert.equal(extract(html.replaceAll('2027','2026')).lineup,undefined);assert.equal(extract(html.replaceAll('line_up__stage','renamed')).lineup,undefined);
});
test('next edition and changed dates are read dynamically',()=>{
 const c=extract(html.replaceAll('2027','2028').replace(/August\s+5 -\s+8/, 'August 3 - 6'),{...source,editionYear:2028});assert.equal(c.startDate,'2028-08-03');assert.equal(c.endDate,'2028-08-06');assert.equal(c.lineup.length,42);
 const september=extract(html.replace(/August\s+5 -\s+8/, 'September 2 - 5'));assert.equal(september.startDate,'2027-09-02');
});
test('homepage discovery follows current stage listing, not old events or tickets',async()=>{
 const seen=[];const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{seen.push(String(url));return new Response(seen.length===1?'<a href="/events/boa-2026/stages">Archive</a><a href="/events/boa-2027/stages">Line up</a>':html);}});assert.deepEqual(seen,['https://www.bloodstock.uk.com/','https://www.bloodstock.uk.com/events/boa-2027/stages']);assert.equal(extract(await fetched.response.text()).lineup.length,42);
});
