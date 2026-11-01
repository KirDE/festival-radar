import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {GRASPOP_FAQ,GRASPOP_HOME,GRASPOP_ROSTER,discoverGraspopAnnouncements} from '../lib/ingestion/adapters/graspop.ts';
const fixture=name=>readFileSync(new URL('./fixtures/graspop-current/'+name,import.meta.url),'utf8');
const manifest=JSON.parse(fixture('manifest.json'));
const envelope=()=>({kind:manifest.kind,faq:fixture(manifest.faq),home:fixture(manifest.home),roster:fixture(manifest.roster),articles:manifest.articles.map(a=>({url:a.url,html:fixture(a.file)}))});
const source={festivalSlug:'graspop',url:GRASPOP_FAQ,editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'daily'};
const at='2026-11-01T13:00:00Z';
const parse=e=>extractFestivalCandidate(JSON.stringify(e),source,at);
const names=['blink-182','Evanescence','Faith No More','Marilyn Manson','Mötley Crüe','Parkway Drive'];
const current={slug:'graspop',editionYear:2027,startDate:'2027-06-17',endDate:'2027-06-20',headliners:names,lineup:[],status:'partial',ticketStatus:'unknown'};

test('real FAQ, homepage, roster and six own-edition news excerpts give explicitly corroborated headlines',()=>{
 const c=parse(envelope());assert.deepEqual(c.headliners,names);assert.equal(c.startDate,'2027-06-17');assert.equal(c.endDate,'2027-06-20');assert.equal(c.artistListMode,'additive');assert.equal(c.lineupScope,'announcement');assert.equal(c.status,'partial');assert.deepEqual(c.observedEditionYears,[2027]);assert.deepEqual(c.warnings,[]);
 assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,undefined);
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
 const first=evaluateCandidate({...current,headliners:[],status:'tba'},c);assert.equal(first.changes.filter(x=>x.kind==='headliner_added').length,6);assert.deepEqual(first.reviewReasons,[]);assert.equal(first.publishable,true);
});
test('a later paired official card/article is discovered without a hardcoded count; verified additions are catalog-publishable',()=>{
 const e=envelope();const old=e.articles.at(-1);const url=old.url.replace(/[^/]+$/,'new-headliner-for-gmm-2027');
 const card=[...e.roster.matchAll(/<article\b[^>]*class="artist"[^>]*>[\s\S]*?<\/article>/g)].find(m=>m[0].includes('>blink-182<'))[0];
 const news=[...e.home.matchAll(/<article\b[^>]*class="news"[^>]*>[\s\S]*?<\/article>/g)].find(m=>m[0].includes(new URL(old.url).pathname))[0];
 const rename=s=>s.replaceAll('blink-182','Future Headliner').replaceAll('/en/bands/Future Headliner','/en/bands/future-headliner').replace(/[a-f0-9]{40}/g,'a'.repeat(40));
 e.roster=e.roster.replace('</ol>',rename(card)+'</ol>');
 e.home=e.home.replace('</main>',rename(news).replaceAll(new URL(old.url).pathname,new URL(url).pathname)+'</main>');
 e.articles.push({url,html:rename(old.html).replaceAll(old.url,url)});
 const c=parse(e);assert.equal(c.headliners.length,7);assert.ok(c.headliners.includes('Future Headliner'));assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);assert.equal(evaluateCandidate(current,c).publishable,true);
});
test('announcement subsets cannot remove saved artists or downgrade a full bill',()=>{
 const e=envelope();e.roster=e.roster.replace(/<article\b[^>]*class="artist"[^>]*>[\s\S]*?<\/article>/,'');
 const c=parse(e);assert.equal(c.headliners.length,5);
 const r=evaluateCandidate({...current,status:'confirmed',headliners:[...names,'Later Act']},c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test('wrong year, conflicting dates, unpaired/truncated/off-origin cards and canonical drift fail closed',()=>{
 const cases=[
 e=>e.faq=e.faq.replaceAll('2027','2026'),
 e=>e.articles[0].html=e.articles[0].html.replaceAll('2027','2026'),
 e=>e.articles[0].html=e.articles[0].html.replace('From 17- 20 June','From 18- 21 June'),
 e=>e.articles.pop(),
 e=>e.roster=e.roster.replace('class="artist__name"','class="unknown"'),
 e=>e.roster=e.roster.replace('</article>',''),
 e=>e.roster=e.roster.replace('</ol>',''),
 e=>e.roster=e.roster.replace('/en/bands/blink-182','https://evil.test/en/bands/blink-182'),
 e=>e.roster=e.roster.replace('class="artists-list"','class="archive-list"'),
 e=>e.articles[0].html=e.articles[0].html.replace('<link rel="canonical" href="https://www.graspop.be','<link rel="canonical" href="https://evil.test'),
 e=>e.articles[0].html=e.articles[0].html.replace('Evanescence!', 'Evanescence! They have cancelled.'),
 ];
 for(const mutate of cases){const e=envelope();mutate(e);const c=parse(e);assert.equal(c.headliners,undefined);assert.ok(c.warnings.length);assert.ok(evaluateCandidate(current,c).reviewReasons.length);}
});
test('actual full discovery topology survives benign edits; scripts/navigation and unrelated news are excluded',()=>{
 const e=envelope();assert.equal(discoverGraspopAnnouncements(e.home).length,6);
 e.home=e.home.replaceAll('class="news"','data-extra="1" class="news"')+'<footer><article class="news"><a href="/en/news/fake"><h3 class="news__title">First headliner for GMM 2027</h3></a></article></footer>';
 assert.equal(discoverGraspopAnnouncements(e.home).length,6);assert.deepEqual(parse(e).headliners,names);
 e.home=e.home.replace(/<main>[\s\S]*<\/main>/,'<main><h1>See you in 2027</h1></main>');e.articles=[];e.roster='';const quiet=parse(e);assert.deepEqual(quiet.warnings,[]);assert.equal(quiet.startDate,'2027-06-17');
});
test('fetch follows only the bounded official documents, preserves errors and refuses identity-changing redirects',async()=>{
 const e=envelope();const docs=new Map([[source.url,e.faq],[GRASPOP_HOME,e.home],[GRASPOP_ROSTER,e.roster],...e.articles.map(a=>[a.url,a.html])]);
 const calls=[];const fetchImpl=async(url,options)=>{calls.push(url);if(url!==source.url)assert.equal(options.redirect,'error');assert.ok(docs.has(url));return new Response(docs.get(url));};
 const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl});assert.equal(fetched.attempts,9);assert.deepEqual(parse(JSON.parse(await fetched.response.text())).headliners,names);assert.equal(calls.length,9);
 const failed=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url,opts)=>url===GRASPOP_ROSTER?new Response('not found',{status:404}):fetchImpl(url,opts)});assert.equal(failed.response.status,404);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async(url,opts)=>{const r=await fetchImpl(url,opts);if(url===GRASPOP_HOME)Object.defineProperty(r,'url',{value:'https://evil.test/'});return r;}}),/official identity/);
});
