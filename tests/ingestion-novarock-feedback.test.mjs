import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {novarockDocuments,novarockTicketsUrl} from '../lib/ingestion/adapters/novarock.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
const dir=new URL('./fixtures/official-markup/',import.meta.url);
const lineup=await readFile(new URL('novarock-feedback-lineup.html',dir),'utf8');
const tickets=await readFile(new URL('novarock-feedback-tickets.html',dir),'utf8');
const source={festivalSlug:'nova-rock',url:'https://www.novarock.at/lineup/',editionYear:2027,strategies:['official_markup'],refreshPolicy:'weekly',enabled:true};
const extract=(ticketDoc=tickets,lineupDoc=lineup)=>extractFestivalCandidate(novarockDocuments(lineupDoc,ticketDoc),source,'2026-10-10T13:59:00Z');
const parsed=extract();
const current={slug:'nova-rock',editionYear:2027,startDate:'2027-06-09',endDate:'2027-06-12',status:'partial',headliners:parsed.headliners,lineup:parsed.lineup,ticketsUrl:novarockTicketsUrl,ticketStatus:'available'};
test('real feedback: live regular pass remains available despite sold-out VIP/caravan; canonical Static-X is preserved',()=>{
 assert.equal(parsed.lineup.length,40);assert.ok(parsed.lineup.includes('Static-X'));assert.ok(!parsed.lineup.includes('Static X'));
 assert.equal(parsed.ticketsUrl,novarockTicketsUrl);assert.equal(parsed.ticketStatus,'available');assert.equal(parsed.status,undefined);
 for(const field of ['ticketsUrl','ticketStatus'])assert.ok(parsed.evidence.some(e=>e.field===field&&e.sourceUrl===novarockTicketsUrl&&e.excerpt.includes('279.99')));
 assert.deepEqual(evaluateCandidate(current,parsed).changes,[]);assert.deepEqual(evaluateCandidate(current,parsed).reviewReasons,[]);
});
test('ticket-only changes no longer force lineup/provider review but genuine later acts remain gated',()=>{
 const missing=evaluateCandidate({...current,ticketsUrl:undefined,ticketStatus:'unknown'},parsed);assert.equal(missing.publishable,true);assert.ok(missing.changes.every(c=>['ticketsUrl','ticketStatus'].includes(c.field)));
 const added=extract(tickets,lineup.replace(/(<h2 class="artistCard__title[^"]*">)\s*Evanescence\s*(<\/h2>)/, '$1New Official Act$2'));const result=evaluateCandidate(current,added);assert.equal(result.publishable,false);assert.ok(result.reviewReasons.some(r=>r.includes('provider activity')));
 const blocked={...parsed,warnings:[...parsed.warnings,'Independent source error']};assert.ok(evaluateCandidate(current,blocked).reviewReasons.includes('Independent source error'));
});
test('changed live standard pass price is supported; stale years, ambiguous standard offers and untrusted purchase fail closed',()=>{
 assert.equal(extract(tickets.replace('279.99','299.99')).ticketStatus,'available');
 for(const doc of [tickets.replaceAll('Festivalpass 2027','Festivalpass 2026'),tickets.replace('https://www.oeticket.com/noapp/event/nova-rock-2027','https://evil.test/noapp/event/nova-rock-2027'),tickets.replaceAll('https://www.novarock.at/tickets/','https://www.novarock.at/old-tickets/')]){
  const c=extract(doc);assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,undefined);
 }
 assert.equal(extract(tickets.replace('<li class="ticketCard ticketOffers__item">','<li hidden class="ticketCard ticketOffers__item">')).ticketStatus,undefined);
 const offer=tickets.match(/<li class="ticketCard__offer is:available">[\s\S]*?<\/li>/)[0];
 assert.equal(extract(tickets.replace(offer,offer+offer)).ticketStatus,undefined);
 assert.equal(extract(tickets.replace(offer,offer.replace('is:available','is:sold_out'))).ticketStatus,undefined);
});
test('actual standard-pass sellout and reopening are scoped to that offer',()=>{
 const offer=tickets.match(/<li class="ticketCard__offer is:available">[\s\S]*?<\/li>/)[0];
 const sold='<li class="ticketCard__offer is:sold_out"><h4 class="ticketCard__offerTitle">Festivalpass</h4><strong class="ticketCard__offerInfoNotice">Sold Out!</strong></li>';
 assert.equal(extract(tickets.replace(offer,sold)).ticketStatus,'unavailable');assert.equal(extract().ticketStatus,'available');
});
test('two-document fetch uses fixed official ticket URL and preserves real HTTP failures',async()=>{
 const calls=[];const response=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=>{calls.push(url);return new Response(url===source.url?lineup:tickets)}});
 assert.deepEqual(calls,[source.url,novarockTicketsUrl]);assert.equal(response.attempts,2);assert.equal(extractFestivalCandidate(await response.response.text(),source,'2026-10-10').ticketStatus,'available');
 const failed=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=>new Response(url===source.url?lineup:'Forbidden',{status:url===source.url?200:403})});assert.equal(failed.response.status,403);assert.equal(failed.attempts,2);
 const manualCalls=[];await fetchSource({...source,strategies:['manual_review']},{maxAttempts:1,fetchImpl:async(url)=>{manualCalls.push(url);return new Response(lineup)}});assert.deepEqual(manualCalls,[source.url]);
});
