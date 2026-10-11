import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { extractPaleoCandidate } from '../lib/ingestion/adapters/paleo.ts';
import { fetchSource } from '../lib/ingestion/fetch.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const fixtures = ['en','fr'].map(lang => readFileSync(new URL(`./fixtures/paleo-tickets-${lang}.html`,import.meta.url),'utf8'));
const source = {festivalSlug:'paleo',url:'https://yeah.paleo.ch/',strategies:['json_ld_event','html_fallback'],editionYear:2027,enabled:true,refreshPolicy:'every_3_days'};
const at = '2026-10-10T22:08:00Z';
const parse = (html,s=source,date=at) => extractFestivalCandidate(html,s,date);
const current = {slug:'paleo',editionYear:2027,startDate:'2027-07-19',endDate:'2027-07-25',ticketsUrl:'https://yeah.paleo.ch/en/tickets',ticketStatus:'unavailable',status:'tba',lineup:[],headliners:[]};

test('actual corrected Paléo announcement in both official locales, not archived programme or artist wishes', () => {
 for(const fixture of fixtures){const c=parse(fixture);assert.equal(c.startDate,current.startDate);assert.equal(c.endDate,current.endDate);assert.equal(c.ticketsUrl,current.ticketsUrl);assert.equal(c.ticketStatus,'unavailable');assert.deepEqual(c.observedEditionYears,[2027]);assert.deepEqual(c.warnings,[]);for(const field of ['lineup','headliners','status'])assert.equal(c[field],undefined);const result=evaluateCandidate(current,c);assert.deepEqual(result.changes,[]);assert.deepEqual(result.reviewReasons,[]);}
});

test('later official dates and edition remain dynamic without a bill or content-hash allowlist',()=>{
 const c=parse(fixtures[0].replaceAll('2027','2028').replaceAll('2026','2027').replace('19 to 25 July','18 to 24 June'),{...source,editionYear:2028},'2027-10-01T00:00:00Z');assert.equal(c.startDate,'2028-06-18');assert.equal(c.endDate,'2028-06-24');assert.equal(c.ticketStatus,'unavailable');
});

test('future opening copy no longer establishes unavailability once the announced month begins',()=>{
 for(const date of ['2026-12-01T00:00:00Z','2027-01-01T00:00:00Z'])assert.equal(parse(fixtures[0],source,date).ticketStatus,undefined);
 assert.equal(parse(fixtures[0].replace('December 2026','December 2025')).ticketStatus,undefined);
});

test('account, generic purchase and past-edition sold-out notices do not prove current ticket inventory',()=>{
 const html=fixtures[0].replace('The Christmas offer will open in','The previous offer opened in')+'<p>2026 SOLD OUT</p><a href="https://tickets.paleo.ch/account/login">Buy tickets</a>';
 assert.equal(parse(html).ticketStatus,undefined);
});

test('hidden or conflicting dates fail closed; wrong visible edition is still a review',()=>{
 for(const html of [fixtures[0].replace('19 to 25 July','30 to 32 July'),fixtures[0].replace('19 to 25 July','25 to 19 July'),fixtures[0].replace('19 to 25 July','29 to 31 February'),`<div hidden>${fixtures[0]}</div>`,fixtures[0]+'<h3>The next edition of the Festival will take place from 20 to 25 July 2027.</h3>'])assert.equal(extractPaleoCandidate(html,source,at),undefined);
 const c=parse(fixtures[0].replaceAll('2027','2026'));assert.ok(evaluateCandidate(current,c).reviewReasons.length>0);
 assert.equal(parse('<!--<h3>The next edition of the Festival will take place from 20 to 25 July 2026.</h3>-->'+fixtures[0]).startDate,'2027-07-19');
});

test('adapter is scoped to the real official origin and page routes',()=>{
 for(const url of ['https://evil.example/','https://yeah.paleo.ch/en/news/archive','https://yeah.paleo.ch/?year=2026'])assert.equal(extractPaleoCandidate(fixtures[0],{...source,url},at),undefined);
});

test('actual localized homepage link is discovered; external ticket and hidden links are not followed',async()=>{
 const calls=[];const r=await fetchSource(source,{fetchImpl:async url=>{calls.push(url);const response=new Response(calls.length===1?'<a href="https://evil.example/en/tickets">Tickets</a><div hidden><a href="/en/tickets">Hidden</a></div><a href="/fr/billetterie">Billetterie</a>':fixtures[1]);Object.defineProperty(response,'url',{value:calls.length===1?'https://yeah.paleo.ch/fr':url});return response;}});
 assert.deepEqual(calls,[source.url,'https://yeah.paleo.ch/fr/billetterie']);assert.equal(r.attempts,2);assert.deepEqual(evaluateCandidate(current,parse(await r.response.text())).changes,[]);
});

test('HTTP403 on ticket page remains a source failure',async()=>{
 let calls=0;const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async()=>new Response(++calls===1?'<a href="/en/tickets">Tickets</a>':'blocked',{status:calls===1?200:403})});assert.equal(r.response.status,403);assert.equal(r.attempts,2);
});

test('off-origin or unsupported ticket redirects fail closed',async()=>{
 for(const phase of [1,2]){let calls=0;await assert.rejects(fetchSource(source,{fetchImpl:async()=>{const r=new Response(++calls===1?'<a href="/en/tickets">Tickets</a>':fixtures[0]);Object.defineProperty(r,'url',{value:calls===phase?'https://evil.example/en/tickets':calls===1?source.url:'https://yeah.paleo.ch/en/tickets'});return r;}}),/redirected away/);}
});

test('explicit fetch configuration and direct ticket URL do not cause extra discovery',async()=>{
 for(const s of [{...source,fetchUrl:'https://yeah.paleo.ch/en/tickets'},{...source,url:'https://yeah.paleo.ch/en/tickets'}]){let calls=0;const r=await fetchSource(s,{fetchImpl:async()=>{calls++;return new Response(fixtures[0]);}});assert.equal(calls,1);assert.equal(parse(await r.response.text(),s).startDate,current.startDate);}
});
