import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {alpenAnnouncements,alpenEnvelope,extractAlpenFlairCandidate,ALPEN_ARTIST_REVIEW} from '../lib/ingestion/adapters/alpen-flair.ts';
const home=readFileSync(new URL('./fixtures/alpen-flair/home.html',import.meta.url),'utf8'), article=readFileSync(new URL('./fixtures/alpen-flair/article.html',import.meta.url),'utf8');
const source={festivalSlug:'alpen-flair',url:'https://www.alpen-flair.com/',editionYear:2027,strategies:['json_ld_event','html_fallback'],enabled:true,refreshPolicy:'every_3_days'};
const at='2026-10-11T08:40:00Z';
const envelope=(h=home,a=article)=>alpenEnvelope(h,[{url:alpenAnnouncements(h,2027)[0],html:a}]);
const parse=(h=envelope(),s=source)=>extractFestivalCandidate(h,s,at);
const current={slug:'alpen-flair',editionYear:2027,startDate:'2027-06-23',endDate:'2027-06-26',lineup:['Alestorm','Kärbholz','Kastelruther Spatzen','Luca-Dante Spadafora','Artefuckt','Troglauer','Frenzy','Mixed Up Everything'],headliners:[],status:'partial',ticketsUrl:source.url,ticketStatus:'available'};
test('real correction: textual captions are additive, all eight reviewed artists remain, no invented headliners',()=>{
 const c=parse();assert.deepEqual(c.lineup,current.lineup.slice(0,3));assert.equal(c.headliners,undefined);assert.equal(c.artistListMode,'additive');assert.equal(c.lineupScope,'announcement');for(const f of ['startDate','endDate','status','ticketsUrl','ticketStatus'])assert.equal(c[f],current[f]);assert.deepEqual(c.observedEditionYears,[2027]);const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test('a later new caption is extracted dynamically but cannot trigger provider work automatically',()=>{
 const a=article.replace('Kastelruther Spatzen','Future Artist');const c=parse(envelope(home,a));assert.ok(c.lineup.includes('Future Artist'));const r=evaluateCandidate(current,c);assert.ok(r.changes.some(x=>x.after==='Future Artist'));assert.ok(r.reviewReasons.includes(ALPEN_ARTIST_REVIEW));assert.equal(r.publishable,false);
});
test('new caption already reviewed as headliner does not demote billing or cause another review',()=>{
 const c=parse(envelope(home,article.replace('Kastelruther Spatzen','Future Artist')));const r=evaluateCandidate({...current,headliners:['Future Artist']},c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test('confirmed bill cannot be downgraded by this partial announcement',()=>{assert.deepEqual(evaluateCandidate({...current,status:'confirmed'},parse()).changes,[]);});
test('only same-origin current-edition Joomla artist announcements are discovered, not bands 2026/social/shop',()=>{
 assert.equal(alpenAnnouncements(home,2027).length,1);const injected=home+'<a href="https://evil.example/index.php?view=article&id=88:alpen-flair-2027-bandwelle">x</a><div hidden><a href="/index.php?view=article&id=99:alpen-flair-2027-bands">x</a></div><a href="/bands-2026">Bands</a>';assert.deepEqual(alpenAnnouncements(injected,2027),alpenAnnouncements(home,2027));assert.deepEqual(alpenAnnouncements(home,2028),[]);
});
test('dynamic subsequent edition and date span do not require a document hash or roster allowlist',()=>{
 const h=home.replaceAll('2027','2028').replace('June 23-26','June 22-25'),a=article.replaceAll('2027','2028');const c=parse(alpenEnvelope(h,[{url:alpenAnnouncements(h,2028)[0],html:a}]),{...source,editionYear:2028});assert.equal(c.startDate,'2028-06-22');assert.equal(c.endDate,'2028-06-25');assert.equal(c.ticketStatus,'available');assert.deepEqual(c.lineup,current.lineup.slice(0,3));
});
test('wrong/hidden/ambiguous/invalid date headings fail closed',()=>{
 for(const h of [home.replaceAll('2027','2026'),'<div hidden>'+home+'</div>',home.replace('June 23-26','June 30-32'),home.replace('June 23-26','June 26-23'),home+'<h1>June 22-25 2027 - NATZ, SOUTH TYROL</h1>']){const c=parse(h);assert.equal(c.startDate,undefined);assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);}
});
test('sales proof requires current festival ticket image, exact live copy and enabled purchase control in the same card',()=>{
 for(const h of [home.replaceAll('AF2027_Festival_Ticket','AF2026_Festival_Ticket'),home.replace('VVK ist gestartet!','VVK startet bald!'),home.replace('JETZT bestellt werden!','später bestellt werden!'),home.replace('target="_blank">JETZT BESTELLEN!','aria-disabled="true" target="_blank">JETZT BESTELLEN!'),home.replace('VVK ist gestartet!','VVK ist gestartet! Ausverkauft')]){const c=parse(envelope(h));assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,undefined);}
});
test('sales copy from outside the ticket card cannot establish availability',()=>{
 const h=home.replace('VVK ist gestartet!','Waiting')+'<h3>VVK ist gestartet!</h3>';assert.equal(parse(envelope(h)).ticketStatus,undefined);
});
test('image-only/hidden or wrong-edition article must not fabricate artists',()=>{
 for(const a of ['<main><h2>ALPEN FLAIR 2027 BANDWELLE</h2><img src="bill.png"></main>','<div hidden>'+article+'</div>',article.replaceAll('2027','2026')]){const c=parse(envelope(home,a));assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);}
});
test('envelope must reference discovered official links, never injected external evidence',()=>{
 const c=parse(alpenEnvelope(home,[{url:'https://evil.example/',html:article}]));assert.equal(c.lineup,undefined);
 for(const url of ['https://evil.example/','https://www.alpen-flair.com/bands','https://www.alpen-flair.com/?year=2026'])assert.equal(extractAlpenFlairCandidate(envelope(),{...source,url},at),undefined);
});
test('fetch reproduces actual two-document source with no requests to shop, archive or social providers',async()=>{
 const calls=[];const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async(u,options)=>{calls.push(u);if(calls.length===2)assert.equal(options.redirect,'error');return new Response(calls.length===1?home:article);}});assert.deepEqual(calls,[source.url,...alpenAnnouncements(home,2027)]);assert.equal(r.attempts,2);assert.deepEqual(evaluateCandidate(current,parse(await r.response.text())).changes,[]);
});
test('real HTTP403 remains failure and redirected announcement must fail closed',async()=>{
 let n=0;const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async()=>new Response(++n===1?home:'blocked',{status:n===1?200:403})});assert.equal(r.response.status,403);assert.equal(r.attempts,2);
 for(const phase of [1,2]){let count=0;await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async()=>{const r=new Response(++count===1?home:article);Object.defineProperty(r,'url',{value:count===phase?'https://evil.example/':count===1?source.url:alpenAnnouncements(home,2027)[0]});return r;}}),/redirected away/);}
});
test('explicit fetch configuration does not add automatic discovery',async()=>{let calls=0;await fetchSource({...source,fetchUrl:source.url},{fetchImpl:async()=>{calls++;return new Response(home);}});assert.equal(calls,1);});

test('unverified current announcement discovery and conflicting article date stay reviewable',()=>{
 const c=parse(home);assert.ok(c.warnings.some(w=>w.includes('link could not be verified')));const a=article.replace('26.06.2027','26.06.2026');const r=parse(envelope(home,a));assert.equal(r.lineup,undefined);assert.ok(r.warnings.some(w=>w.includes('dates differ')));
});
