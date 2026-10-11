import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {LEYENDAS_ORIGIN as origin, LEYENDAS_ARTIST_REVIEW, leyendasNewsLinks} from '../lib/ingestion/adapters/leyendas.ts';
import {validateSource} from '../lib/sources/repository.ts';
const data=JSON.parse(await readFile(new URL('./fixtures/official-markup/leyendas-news.json',import.meta.url),'utf8'));
const source={festivalSlug:'leyendas-del-rock',url:origin+'/',editionYear:2027,enabled:true,refreshPolicy:'weekly',strategies:['official_markup']};
const at='2026-10-11T09:25:00Z';
// The independently reviewed image bill is a policy baseline, never an adapter
// lookup table. The incomplete textual announcements must retain EVERY name.
const current={slug:source.festivalSlug,editionYear:2027,startDate:'2027-08-11',endDate:'2027-08-14',status:'partial',ticketStatus:'available',ticketsUrl:origin+'/tickets/',headliners:['Mercyful Fate','Architects','Saxon'],lineup:['Halestorm','Alestorm','Skillet','Angelus Apatrida','Wind Rose','Amaranthe','Saltatio Mortis','DevilDriver','Doro','Dethklok','Therion','Gloryhammer','Tierra Santa','Atreyu','Celtian','Make Them Suffer','Shadow of Intent','Twilight Force','Gutalax','Asomvel','Party Cannon','Roses of Thieves','False Reality','Revnoir','Knocked Loose']};
const parse=(input=data, config=source)=>extractFestivalCandidate(JSON.stringify(input),config,at);
const copy=()=>structuredClone(data);
test('reproduces corrected textual acts, Saxon headliner and official current pass, not stale homepage stock',()=>{
 const c=parse();assert.deepEqual(c.headliners,['Saxon']);assert.deepEqual(c.lineup,['Knocked Loose','Angelus Apatrida','Gloryhammer','Asomvel','Party Cannon','Skillet']);assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,current.ticketsUrl);assert.equal(c.startDate,undefined);assert.equal(c.endDate,undefined);assert.equal(c.status,'partial');assert.equal(c.lineupScope,'announcement');assert.equal(c.artistListMode,'additive');assert.deepEqual(c.observedEditionYears,[2027]);assert.deepEqual(c.warnings,[LEYENDAS_ARTIST_REVIEW]);assert.equal(validateSource(source),'official_markup:leyendas-del-rock');
});
test('all 28 independently corrected names and poster-only billing are preserved: zero diff/review/provider work',()=>{
 const r=evaluateCandidate(current,parse());assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false);assert.equal(r.candidate.headliners.includes('Halestorm'),false);
});
test('guest/fan/song/individual mentions and archive sidebar are not festival artists',()=>{const c=parse();for(const n of ['Metallica','Motionless In White','Poppy','Turnstile','Bryan Garris','Counting Worms','Paleface Swiss'])assert.equal(c.lineup.includes(n),false);});
test('original manual_review remains inert and reproduces unnecessary review until protected activation',()=>{const c=parse(data,{...source,strategies:['manual_review']});assert.equal(c.lineup,undefined);assert.match(c.warnings[0],/^Manual review only/);});
test('future official single-band announcements add dynamic names, retain bill and require provider review',()=>{
 const d=copy(),url=origin+'/a-new-artist-2027/';d.news+=`<a href="${url}"><h2 class="lc_post_title">NEW ARTIST CONFIRMADO EN LEYENDAS DEL ROCK 2027!</h2></a>`;d.posts.push({url,html:'<h1 class="title_full_color">NEW ARTIST CONFIRMADO EN LEYENDAS DEL ROCK 2027!</h1>'});const r=evaluateCandidate(current,parse(d));assert.deepEqual(r.changes.map(c=>[c.kind,c.after]),[['artist_added','New Artist']]);assert.ok(r.reviewReasons.includes(LEYENDAS_ARTIST_REVIEW));assert.equal(r.publishable,false);
});
test('confirmed full bill is never downgraded by partial news',()=>assert.deepEqual(evaluateCandidate({...current,status:'confirmed'},parse()).changes,[]));
test('no document hash or frozen year: changed layout/copyright and next edition supported',()=>{
 const d=JSON.parse(JSON.stringify(data).replaceAll('2027','2028').replaceAll('transition4','new-layout'));const c=parse(d,{...source,editionYear:2028});assert.deepEqual(c.headliners,['Saxon']);assert.equal(c.ticketStatus,'available');assert.deepEqual(c.observedEditionYears,[2028]);
});
test('unknown or image-only new announcement returns to review without guessing/removing artists',()=>{
 const d=copy(),url=origin+'/new-poster-2027/';d.news+=`<a href="${url}"><h2 class="lc_post_title">NUEVO CARTEL LEYENDAS DEL ROCK 2027!</h2></a>`;d.posts.push({url,html:'<h1 class="title_full_color">NUEVO CARTEL LEYENDAS DEL ROCK 2027!</h1><img src="/new-poster.png" alt="">'});const r=evaluateCandidate(current,parse(d));assert.deepEqual(r.changes,[]);assert.match(r.reviewReasons.join(' '),/image review/);
});
test('cancellation of a known artist is reviewed instead of cleared or silently re-added',()=>{const d=copy();d.posts[0].html+='<p class="wp-block-paragraph">Actuación cancelada</p>';const c=parse(d);assert.equal(c.lineup.includes('Knocked Loose'),false);assert.match(evaluateCandidate(current,c).reviewReasons.join(' '),/cancellation/);});
for(const [label,modify] of [
 ['wrong ticket edition',d=>d.tickets=d.tickets.replaceAll('2027','2026')],
 ['sold out admission',d=>d.tickets=d.tickets.replace('Ya se pueden adquirir','Abonos agotados. Ya se pueden adquirir')],
 ['camping-only purchase',d=>d.tickets=d.tickets.replace('COMPRAR ABONO','COMPRAR CAMPING')],
 ['disabled purchase',d=>d.tickets=d.tickets.replace('target="_blank"','aria-disabled="true" target="_blank"')],
 ['foreign seller',d=>d.tickets=d.tickets.replaceAll('www.enterticket.es','untrusted.example.test')],
 ['missing purchase link',d=>d.tickets=d.tickets.replaceAll('COMPRAR ABONO','información')],
])test(label+' cannot claim tickets available from stale homepage',()=>{const d=copy();modify(d);assert.equal(parse(d).ticketStatus,undefined);});
test('source origin and current edition are fenced',()=>{assert.equal(parse(data,{...source,url:'https://other.example/'}).lineup,undefined);assert.equal(parse(data,{...source,editionYear:2028}).lineup,undefined);});
test('discovery excludes external, archive, sidebar and navigation links',()=>{const html=data.news+`<a href="https://evil.example/next"><h2 class="lc_post_title">BAD CONFIRMADO EN LEYENDAS DEL ROCK 2027</h2></a><a href="${origin}/archive/"><h2 class="lc_post_title">OLD CONFIRMADO EN LEYENDAS DEL ROCK 2026</h2></a><a href="${origin}/fake/">NEW CONFIRMADO EN LEYENDAS DEL ROCK 2027</a>`;assert.equal(leyendasNewsLinks(html,source).length,3);});
function fetchFixture(d=data,hook){const calls=[];const documents=new Map([[source.url,d.home],[origin+'/noticias/',d.news],[origin+'/tickets/',d.tickets],...d.posts.map(p=>[p.url,p.html])]);return {calls,fetchImpl:async(url,options)=>{calls.push(url);const override=hook?.(url,options);return override??new Response(documents.get(url),{status:documents.has(url)?200:404});}};}
test('fetches same-origin live news and pass documents plus each current article, not image guesses',async()=>{const f=fetchFixture();const r=await fetchSource(source,{fetchImpl:f.fetchImpl,maxAttempts:1});assert.equal(r.response.status,200);assert.equal(r.attempts,6);assert.equal(parse(JSON.parse(await r.response.text())).ticketStatus,'available');assert.equal(f.calls.length,6);});
test('linked real HTTP403 remains source failure, never a pretend completed parse',async()=>{const f=fetchFixture(data,url=>url.endsWith('/noticias/')?new Response('Forbidden',{status:403}):undefined);const r=await fetchSource(source,{fetchImpl:f.fetchImpl,maxAttempts:1});assert.equal(r.response.status,403);assert.equal(r.attempts,2);});
test('HTTP200 verification challenges are errors, not empty announcements',async()=>{const f=fetchFixture(data,url=>url.endsWith('/noticias/')?new Response('<title>One moment, please...</title>Please wait while your request is being verified...'):undefined);await assert.rejects(fetchSource(source,{fetchImpl:f.fetchImpl,maxAttempts:1}),/verification challenge/);});
test('missing official routes fail safely and manual strategy does not activate discovery',async()=>{const d=copy();d.home='<title>Leyendas del Rock 2027</title>';await assert.rejects(fetchSource(source,{fetchImpl:fetchFixture(d).fetchImpl,maxAttempts:1}),/links are missing/);const f=fetchFixture();await fetchSource({...source,strategies:['manual_review']},{fetchImpl:f.fetchImpl,maxAttempts:1});assert.equal(f.calls.length,1);});

test('incomplete HTTP200 news template cannot silently ignore future lineup updates',async()=>{const d=copy();d.news='<html>Broken template</html>';assert.equal(parse(d).lineup,undefined);await assert.rejects(fetchSource(source,{fetchImpl:fetchFixture(d).fetchImpl,maxAttempts:1}),/index markup is missing/);});
