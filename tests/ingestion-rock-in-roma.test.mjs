import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { fetchSource } from "../lib/ingestion/fetch.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
const html = readFileSync(new URL("./fixtures/rock-in-roma-2027.html", import.meta.url), "utf8");
const source = {festivalSlug:"rock-in-roma",url:"https://rockinroma.com/",editionYear:2027,strategies:["json_ld_event","html_fallback"],enabled:true,refreshPolicy:"daily"};
const extract = (h=html, s=source) => extractFestivalCandidate(h,s,"2026-10-10T22:25:00Z");
const current = {slug:"rock-in-roma",editionYear:2027,status:"partial",headliners:[],lineup:["Slash featuring Myles Kennedy and The Conspirators","Fontaines D.C."],ticketsUrl:"https://rockinroma.com/lineup-2027/",ticketStatus:"unknown"};
test("real current lineup cards exclude old news, navigation and unsupported festival claims", () => {
 const c = extract('<nav><a class="rir-lineup__flyer" href="/concerts/old/" aria-label="OLLY"></a></nav>'+html+'<div class="artist">CAPAREZZA | Info utili</div>');
 assert.deepEqual(c.lineup,current.lineup);assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[2027]);
 assert.equal(c.ticketsUrl,current.ticketsUrl);assert.equal(c.artistListMode,"additive");
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
 assert.deepEqual(calls,[source.url,current.ticketsUrl]);assert.equal(fetched.response.status,status);
 if(status===200) assert.deepEqual(extract(await fetched.response.text()).lineup,current.lineup);
 }
});
test("missing current link cannot fall back to old news, and foreign redirects fail closed",async()=>{
 const result=await fetchSource(source,{fetchImpl:async()=>new Response('<a href="/lineup-2026/">Archive</a>'),maxAttempts:1});assert.ok(extract(await result.response.text()).warnings.length);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async()=>{const r=new Response(html);Object.defineProperty(r,"url",{value:"https://evil.invalid/"});return r;}}),/trusted origin/);
});
