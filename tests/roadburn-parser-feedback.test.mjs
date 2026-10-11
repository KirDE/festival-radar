import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {roadburnDocuments, discoverRoadburnAnnouncements, ROADBURN_ARTIST_REVIEW} from '../lib/ingestion/adapters/roadburn.ts';
const root='https://roadburn.com/';
const source={festivalSlug:'roadburn',url:root,editionYear:2027,strategies:['json_ld_event','html_fallback'],enabled:true,refreshPolicy:'daily'};
const observedAt='2026-10-11T08:15:00.000Z';
const fixture=name=>readFile(new URL(`./fixtures/official-markup/roadburn-${name}-20261010.html`,import.meta.url),'utf8');
const slugs={first:'emma-ruth-rundle-sadness-and-trha-announced-for-roadburn-2027',ian:'ian-added-to-the-line-up',antropoceno:'antropoceno-added-to-the-line-up',neurosis:'neurosis'};
const acts=['Neurosis','Emma Ruth Rundle','Sadness','Trhä','Antropoceno','IAN','Kulk'];
const documents=async()=>Promise.all(Object.entries(slugs).map(async([name,slug])=>({url:root+slug+'/',html:await fixture(name)})));
const input=async()=>roadburnDocuments(await fixture('home'),await documents(),await fixture('tickets'));
const parse=(html,config=source)=>extractFestivalCandidate(html,config,observedAt);
const current={slug:'roadburn',editionYear:2027,startDate:'2027-04-15',endDate:'2027-04-18',status:'partial',ticketStatus:'unknown',ticketsUrl:root+'tickets/',headliners:[],lineup:acts};

test('real corrected news captures all seven 2027 musical acts and dates, never archive/artwork or inferred billing/stock',async()=>{
 const c=parse(await input());assert.deepEqual([...c.lineup].sort(),[...acts].sort());assert.equal(c.startDate,'2027-04-15');assert.equal(c.endDate,'2027-04-18');assert.equal(c.status,'partial');assert.equal(c.lineupScope,'announcement');assert.equal(c.headliners,undefined);assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,root+'tickets/');assert.deepEqual(c.observedEditionYears,[2027]);assert.deepEqual(c.warnings,[ROADBURN_ARTIST_REVIEW]);assert.equal(c.evidence.filter(e=>e.field==='lineup').length,4);
 assert.deepEqual(evaluateCandidate(current,c).changes,[]);assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);
});
test('real news listing discovery finds all four announcements but excludes art, tickets, side-programme and prior editions',async()=>{
 assert.deepEqual(discoverRoadburnAnnouncements(await fixture('news'),2027),[root+slugs.ian+'/',root+slugs.antropoceno+'/',root+slugs.first+'/',root+slugs.neurosis+'/']);
});
test('transport fetches actual same-origin news and each discovered article plus tickets, preserving failures',async()=>{
 const content=new Map([[root,await fixture('home')],[root+'news/',await fixture('news')],[root+'tickets/',await fixture('tickets')],...(await documents()).map(d=>[d.url,d.html])]);const calls=[];
 const f=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url,options)=>{calls.push(url);if(url!==root)assert.equal(options.redirect,'error');assert.ok(content.has(url));return new Response(content.get(url));}});
 assert.equal(f.attempts,7);assert.equal(calls.length,7);assert.deepEqual([...parse(await f.response.text()).lineup].sort(),[...acts].sort());
});
test('homepage alone ignores the archived band grid and on-sale prose',async()=>{
 const c=parse(await fixture('home'));assert.equal(c.lineup,undefined);assert.equal(c.status,undefined);assert.equal(c.ticketStatus,undefined);assert.deepEqual(c.warnings,[]);
});
test('later official artist additions and edition dates work without frozen bills or hashes; new acts require review',async()=>{
 const ds=(await documents()).map(d=>({...d,url:d.url.replaceAll('2027','2028'),html:d.html.replaceAll('2027','2028').replaceAll('2026','2027').replaceAll('Antropoceno','Future Artist')}));
 const home=(await fixture('home')).replaceAll('2027','2028').replace('April 15-18','May 11-14');const c=parse(roadburnDocuments(home,ds,''),{...source,editionYear:2028});assert.ok(c.lineup.includes('Future Artist'));assert.ok(!c.lineup.includes('Antropoceno'));assert.equal(c.startDate,'2028-05-11');assert.equal(c.endDate,'2028-05-14');
 const r=evaluateCandidate({...current,editionYear:2028,startDate:'2028-05-11',endDate:'2028-05-14'},c);assert.ok(r.changes.some(x=>x.after==='Future Artist'));assert.ok(r.reviewReasons.includes(ROADBURN_ARTIST_REVIEW));assert.equal(r.publishable,false);
});
test('individual updates preserve other verified acts, headliner billing and full completeness',async()=>{
 const ds=(await documents()).filter(d=>d.url.endsWith(slugs.ian+'/'));const c=parse(roadburnDocuments(await fixture('home'),ds,''));const r=evaluateCandidate({...current,status:'confirmed',headliners:['IAN','Verified Headliner'],lineup:acts.filter(x=>x!=='IAN').concat('Later Confirmed')},c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test('edition gating uses article body, not current footer, and cancellation gets review instead of replacement',async()=>{
 const ds=await documents();const old=ds.map(d=>({...d,html:d.html.replaceAll('Roadburn 2027','Roadburn 2026').replaceAll('Roadburn in 2027','Roadburn in 2026')+'<footer>Roadburn 2027</footer>'}));assert.equal(parse(roadburnDocuments(await fixture('home'),old,'')).lineup,undefined);
 const cancelled=[{...ds[1],html:ds[1].html.replace('IAN will bring','IAN will not play; IAN will bring')}];const c=parse(roadburnDocuments(await fixture('home'),cancelled,''));assert.equal(c.lineup,undefined);assert.ok(c.warnings.some(w=>w.includes('cancellation')));
});
test('article canonical, structure and names must remain supported instead of quiet false completion',async()=>{
 const ds=await documents();for (const html of [ds[1].html.replace('rel="canonical"','rel="alternate"'),ds[1].html+'<article>Extra story</article>',ds[1].html.replaceAll('will bring','might bring').replaceAll('will descend','might descend')]){
 const c=parse(roadburnDocuments(await fixture('home'),[{...ds[1],html}],''));assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);
 }
});
test('ticket availability needs current edition, explicit four-day stock and live official purchase link',async()=>{
 const home=await fixture('home');const tickets='<p>Roadburn 2027: 4-day tickets available now</p><a href="https://tickets.roadburn.com/current-pass/">Buy tickets</a>';
 assert.equal(parse(roadburnDocuments(home,[],tickets)).ticketStatus,'available');
 for(const changed of [tickets.replace('2027','2026'),tickets.replace('current-pass/','current-pass/offsale'),tickets.replace('tickets.roadburn.com','foreign.invalid'),tickets.replace('4-day tickets available now','Parking tickets available now')])assert.equal(parse(roadburnDocuments(home,[],changed)).ticketStatus,undefined);
});
test('untrusted article links are not fetched and linked HTTP403 remains an actual source failure',async()=>{
 const news=await fixture('news');const external=news.replaceAll('https://roadburn.com/','https://foreign.invalid/');assert.deepEqual(discoverRoadburnAnnouncements(external,2027),[]);
 const f=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>new Response(url===root?await fixture('home'):url===root+'news/'?news:'Forbidden',{status:url===root||url===root+'news/'?200:403})});assert.equal(f.response.status,403);assert.equal(f.attempts,3);
});
test('linked response redirects away from reviewed URL are rejected',async()=>{
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{const r=new Response(await fixture('home'));Object.defineProperty(r,'url',{value:url===root?root:'https://foreign.invalid/'});return r;}}),/redirected away/);
});
test('date drift and invalid spans do not invent current dates; unrelated festivals keep generic behavior',async()=>{
 const home=await fixture('home');for(const h of [home.replaceAll('2027','2026'),home.replace('April 15-18','February 29-31'),home.replace('April 15-18','April 19-18')]){const c=parse(h);assert.equal(c.startDate,undefined);assert.ok(c.warnings.length);}
 const c=parse(await input(),{...source,festivalSlug:'another'});assert.equal(c.lineup,undefined);
});

test('hidden archive assertions and lookalike origins cannot add artists',async()=>{
 const ds=await documents();const hidden=ds[1].html.replace('</article>','<p hidden>Fake will play at Roadburn 2027.</p><p aria-hidden="true">Invisible will play at Roadburn 2027.</p></article>');const c=parse(roadburnDocuments(await fixture('home'),[{...ds[1],html:hidden}],''));assert.deepEqual(c.lineup,['IAN','Kulk']);
 const news=await fixture('news');for(const origin of ['http://roadburn.com/','https://roadburn.com.evil.invalid/','https://user@roadburn.com/'])assert.deepEqual(discoverRoadburnAnnouncements(news.replaceAll(root,origin),2027),[]);
});
