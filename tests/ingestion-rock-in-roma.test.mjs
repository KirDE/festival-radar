import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { ROCK_IN_ROMA_DOCUMENTS, rockInRomaConcerts } from "../lib/ingestion/adapters/rock-in-roma.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const html = readFileSync(new URL("./fixtures/rock-in-roma-2027.html", import.meta.url), "utf8");
const source = {festivalSlug:"rock-in-roma",url:"https://rockinroma.com/",editionYear:2027,strategies:["json_ld_event","html_fallback"],enabled:true,refreshPolicy:"daily"};
const extract = (h=html, s=source) => extractFestivalCandidate(h,s,"2026-10-10T22:25:00Z");
const current = {slug:"rock-in-roma",editionYear:2027,status:"partial",headliners:[],lineup:["Slash featuring Myles Kennedy and The Conspirators","Fontaines D.C."],ticketsUrl:"https://rockinroma.com/lineup-2027/",ticketStatus:"unknown"};
test("real current lineup cards exclude old news, navigation and unsupported festival claims", () => {
 const c = extract('<nav><a class="rir-lineup__flyer" href="/concerts/old/" aria-label="OLLY"></a></nav>'+html+'<div class="artist">CAPAREZZA | Info utili</div>');
 assert.deepEqual(c.lineup,current.lineup);assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[2027]);
 assert.equal(c.ticketsUrl,undefined);assert.equal(c.artistListMode,"additive");
 for(const f of ["startDate","endDate","status","headliners","ticketStatus"]) assert.equal(c[f],undefined);
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test("later edition announcements add artists without deleting verified partial billing",()=>{
 const card='<a class="rir-lineup__flyer" href="/concerts/new-band/" aria-label="New Band &amp; Friends"><img /></a>';
 const c=extract(html.replace('</main>',card+'</main>'));assert.ok(c.lineup.includes("New Band & Friends"));
 const r=evaluateCandidate({...current,lineup:[...current.lineup,"Verified Earlier Act"]},c);
 assert.deepEqual(r.changes.map(x=>[x.kind,x.after]),[["artist_added","New Band & Friends"]]);assert.deepEqual(r.reviewReasons,[]);
});
test("old edition, empty grids and off-origin cards do not manufacture supported facts",()=>{
 for(const h of [html.replace(/2027/g,"2026"),html.replace(/<a class="rir-lineup__flyer"[^>]*>[\s\S]*?<\/a>/g,""),html.replaceAll('href="https://rockinroma.com/concerts/','href="https://evil.invalid/concerts/')]) {
 const c=extract(h);assert.equal(c.lineup,undefined);assert.equal(c.ticketsUrl,undefined);assert.ok(c.warnings.length);
 }
});
test("homepage discovery selects only linked current official lineup and propagates fetch failure",async()=>{
 const home='<a href="https://evil.invalid/lineup-2027/">Wrong host</a><a href="/lineup-2026/">Archive</a><a href="/lineup-2027/">Current</a>';
 for(const status of [200,403]) {
 const calls=[];const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{calls.push(String(url));return new Response(calls.length===1?home:html,{status:calls.length===1?200:status});}});
 assert.deepEqual(calls,status===200?[source.url,current.ticketsUrl,"https://rockinroma.com/concerts/slash-featuring-myles-kennedy-and-the-conspirators/","https://rockinroma.com/concerts/fontaines-d-c-2/"]:[source.url,current.ticketsUrl]);assert.equal(fetched.response.status,status);
 if(status===200) assert.deepEqual(extract(await fetched.response.text()).lineup,current.lineup);
 }
});
test("missing current link cannot fall back to old news, and foreign redirects fail closed",async()=>{
 const result=await fetchSource(source,{fetchImpl:async()=>new Response('<a href="/lineup-2026/">Archive</a>'),maxAttempts:1});assert.ok(extract(await result.response.text()).warnings.length);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async()=>{const r=new Response(html);Object.defineProperty(r,"url",{value:"https://evil.invalid/"});return r;}}),/trusted origin/);
});

const ticket = '<a class="rir-footer__ticket" href="https://www.ticketone.it/artist/rock-in-roma/">Tickets</a>';
const lineup = html + ticket;
const cards = rockInRomaConcerts(lineup, source);
const concert = (name, date) => `<section class="rir-concert__heading rir-concert__heading--light"><div class="rir-concert__heading-title"><h3>${name}</h3></div><div class="rir-concert-information">Ippodromo delle Capannelle</div><div class="rir-concert-information">${date}</div></section>`;
const series = (dates=["13 Giugno 2027", "18 Giugno 2027"], extra={}) => JSON.stringify({kind:ROCK_IN_ROMA_DOCUMENTS,lineup,concerts:cards.map((c,i)=>({url:c.url,html:concert(c.name,dates[i])})),...extra});
test("current concert series publishes min/max dates with concert provenance and the general ticket seller",()=>{
 const c=extract(series());assert.equal(c.startDate,"2027-06-13");assert.equal(c.endDate,"2027-06-18");assert.deepEqual(c.warnings,[]);
 assert.equal(c.ticketsUrl,"https://www.ticketone.it/artist/rock-in-roma/");
 assert.equal(c.ticketStatus,undefined);assert.equal(c.headliners,undefined);assert.equal(c.status,undefined);
 assert.equal(c.evidence.find(e=>e.field==='startDate').sourceUrl,cards[0].url);
 assert.equal(c.evidence.find(e=>e.field==='endDate').sourceUrl,cards[1].url);
 assert.equal(c.evidence.find(e=>e.field==='ticketsUrl').sourceUrl,current.ticketsUrl);
 const r=evaluateCandidate(current,c);assert.equal(r.publishable,true);assert.deepEqual(r.changes.map(c=>c.field),['startDate','endDate','ticketsUrl']);
 // Preserve the existing review guard for changes to an already published span.
 assert.equal(evaluateCandidate({...current,startDate:'2027-06-14'},c).publishable,false);
});
test("series sorting covers multiple months, reversed cards and a single concert",()=>{
 let c=extract(series(['19 Luglio 2027','13 Giugno 2027']));assert.equal(c.startDate,'2027-06-13');assert.equal(c.endDate,'2027-07-19');
 const singleLineup=lineup.replace(/<a class="rir-lineup__flyer"[^>]*aria-label="Fontaines D.C."[\s\S]*?<\/a>/,'');
 c=extract(series(undefined,{lineup:singleLineup,concerts:[{url:cards[0].url,html:concert(cards[0].name,'13 Giugno 2027')}]}));
 assert.equal(c.startDate,'2027-06-13');assert.equal(c.endDate,c.startDate);
});
test("missing, ambiguous, invalid, mismatched and archive concert dates never publish a partial range",()=>{
 for(const bad of ['13 Giugno 2026','31 Giugno 2027','29 Febbraio 2027','0 Luglio 2027','Dates TBA']){
  const c=extract(series(['13 Giugno 2027',bad]));assert.equal(c.startDate,undefined);assert.equal(c.endDate,undefined);assert.ok(c.warnings.length);
 }
 for(const docs of [[],[{url:cards[0].url,html:concert('Wrong Act','13 Giugno 2027')}],cards.map(c=>({url:c.url,html:concert(c.name,'13 Giugno 2027').replace('</section>', '<div class="rir-concert-information">20 Giugno 2027</div></section>')}))]){

  const c=extract(series(undefined,{concerts:docs}));assert.equal(c.startDate,undefined);assert.ok(c.warnings.length);
 }
 const duplicate=JSON.parse(series());duplicate.concerts.push(duplicate.concerts[0]);assert.equal(extract(JSON.stringify(duplicate)).startDate,undefined);
 const outside=series(undefined,{concerts:cards.map(c=>({url:c.url,html:'<footer>19 Luglio 2027</footer>'}))});assert.equal(extract(outside).startDate,undefined);
});
test("ticket URL must actually be the official series CTA, not an artist, archive, or injected seller",()=>{
 for(const bad of ['https://evil.invalid/','https://www.ticketone.it/artist/slash/','https://www.ticketone.it/artist/rock-in-roma/?year=2026']){
  assert.equal(extract(lineup.replace('https://www.ticketone.it/artist/rock-in-roma/',bad)).ticketsUrl,undefined);
 }
 assert.equal(extract(ticket+html.replace(/2027/g,'2026')).ticketsUrl,undefined);
 assert.ok(extract('{"kind":"unknown"}').warnings.length);
});
test("fetch follows only current grid concerts, rejects redirects, and propagates detail HTTP errors",async()=>{
 const home='<a href="/lineup-2027/">Current</a>';
 for(const direct of [false,true]){
 const calls=[];const f=await fetchSource(direct?{...source,url:current.ticketsUrl}:source,{maxAttempts:1,fetchImpl:async(url,opts)=>{
 calls.push(String(url));return new Response(url===source.url?home:url===current.ticketsUrl?lineup:concert(cards.find(c=>c.url===url).name,url===cards[0].url?'13 Giugno 2027':'18 Giugno 2027'));
 }});assert.equal(extract(await f.response.text()).endDate,'2027-06-18');assert.deepEqual(calls,[...(direct?[]:[source.url]),current.ticketsUrl,...cards.map(c=>c.url)]);
 }
 const failed=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>new Response(url===source.url?home:lineup,{status:String(url).includes('/concerts/')?403:200})});assert.equal(failed.response.status,403);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{const r=new Response(url===source.url?home:lineup);if(String(url).includes('/concerts/'))Object.defineProperty(r,'url',{value:'https://evil.invalid/'});return r;}}),/trusted identity/);
});

test("captured official 2027 lineup and three concert headings yield June 13–19 without changing artists",()=>{
 const capture=readFileSync(new URL('./fixtures/rock-in-roma-series-2027.json',import.meta.url),'utf8');
 const c=extract(capture);assert.equal(c.startDate,'2027-06-13');assert.equal(c.endDate,'2027-06-19');
 assert.deepEqual(c.lineup,[...current.lineup,'The Chemical Brothers']);
 assert.equal(c.ticketsUrl,'https://www.ticketone.it/artist/rock-in-roma/');assert.deepEqual(c.warnings,[]);
 const r=evaluateCandidate({...current,lineup:c.lineup},c);assert.equal(r.publishable,true);
 assert.ok(r.changes.every(c=>['startDate','endDate','ticketsUrl'].includes(c.field)));
 const parsed=JSON.parse(capture);parsed.concerts[0].html+=parsed.concerts[0].html;
 assert.equal(extract(JSON.stringify(parsed)).startDate,undefined);
});
