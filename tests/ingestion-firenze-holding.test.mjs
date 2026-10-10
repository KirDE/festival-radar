import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runIngestion} from '../lib/ingestion/run.ts';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {validateSource} from '../lib/sources/repository.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=await readFile(new URL('./fixtures/official-markup/firenze-rocks-holding.html',import.meta.url),'utf8');
const source=parserSource('firenze-rocks',{url:'https://www.firenzerocks.it/',refreshPolicy:'weekly'});
const observed='2026-10-10T16:11:00.000Z';
const current={slug:'firenze-rocks',editionYear:2027,name:'Firenze Rocks',city:'Florence',headliners:[],lineup:[],status:'tba',ticketStatus:'unknown'};
function empty(candidate){for(const f of ['startDate','endDate','city','lineup','headliners','status','ticketsUrl','ticketStatus'])assert.equal(candidate[f],undefined);assert.deepEqual(candidate.evidence,[]);}
function quiet(html=fixture,config=source){const c=extractFestivalCandidate(html,config,observed);empty(c);assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[]);const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);return c;}
function review(html){const c=extractFestivalCandidate(html,source,observed);empty(c);assert.match(c.warnings.join(' '),/holding page changed/);assert.equal(evaluateCandidate(current,c).publishable,false);}
test('real corrected official holding page is unchanged, registered, weekly and provider-inert',()=>{assert.equal(validateSource(source),'official_markup:firenze-rocks');quiet();});
test('original manual strategy reproduces pointless review and remains inert until protected activation',()=>{const c=extractFestivalCandidate(fixture,{...source,strategies:['manual_review'],manualReviewReason:'official Live Nation shell does not expose a single authoritative festival date range'},observed);empty(c);assert.match(c.warnings[0],/^Manual review only/);});
test('no exact document hash: layout class, runtime version and copyright changes remain quiet',()=>quiet(fixture.replaceAll('li0owl4','new-layout').replace('v136','v200').replace('2025 Firenze','2026 Firenze')));
test('future year also supports unchanged pre-announcement shell, not a hardcoded festival edition',()=>quiet(fixture,{...source,editionYear:2028}));
test('does not clear a previously verified partial bill or tickets',()=>{const c=quiet(),r=evaluateCandidate({...current,status:'partial',lineup:['Previously verified artist'],ticketsUrl:'https://www.firenzerocks.it/tickets',ticketStatus:'available'},c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);});
for(const[name,change]of [
 ['new text/date/artist announcement',h=>h.replace('</main>','<h3>Firenze Rocks 2027: 15 June, New Artist announced</h3></main>')],
 ['image-only poster',h=>h.replace('</main>','<img src="/poster-2027.jpg" alt=""></main>')],
 ['CSS image-only poster',h=>h.replace('</main>','<div style="background-image:url(/poster.jpg)"></div></main>')],
 ['tickets',h=>h.replace('</main>','<a href="/tickets">Acquista</a></main>')],
 ['changed video announcement',h=>h.replace('video-sito-mob.mp4','announcement-2027.mp4')],
 ['replaced video asset',h=>h.replace('k4tcpivz','new-announcement')],
 ['metadata announcement',h=>h.replace('name="description" content="Home | Firenze Rocks"','name="description" content="Firenze Rocks 2027 bill announced"')],
 ['new edition logo',h=>h.replace('firenze-rocks-2026_primary','firenze-rocks-2027_primary')],
 ['event JSON-LD',h=>h+'<script type="application/ld+json">{"@type":"MusicEvent","name":"Artist","startDate":"2027-06-15"}</script>'],
 ['template drift',h=>h.replaceAll('/holdingPage/','/festivalHome/')],
 ['incomplete/error page',()=>'<title>Home | Firenze Rocks</title><h1>Forbidden</h1>'],
 ['empty main',h=>h.replace(/<main[\s\S]*<\/main>/,'<main></main>')],
 ['unknown widget',h=>h.replace('</main>','<iframe src="/announcement"></iframe></main>')],
 ['announcement hidden in legal footer',h=>h.replace('Copyright © 2025','<img src="/poster.jpg">Copyright © 2025')],
 ['poster masquerading as social icon',h=>h.replace('width="69"','width="1024"')],
 ['new heading beyond shell',h=>h.replace('SEGUICI','LINEUP 2027')],
])test(`new official evidence returns to review: ${name}`,()=>review(change(fixture)));

test('successful no-announcement checks reset health and remain unchanged, not review/failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'firenze-health-'));
 try{const stateFile=join(dir,'state.json');await writeFile(stateFile,JSON.stringify({schemaVersion:1,sources:{'firenze-rocks':{consecutiveFailures:3,lastAttemptAt:'2026-10-01T00:00:00Z',lastSuccessfulExtraction:'2026-09-01T00:00:00Z'}}}));
 const summary=await runIngestion({sources:[source],festivals:[current],outputDirectory:join(dir,'results'),stateFile,failureThreshold:3,now:()=>new Date(observed),fetchOptions:{fetchImpl:async()=>new Response(fixture,{status:200})}});
 assert.equal(summary.reviewRequired,0);assert.equal(summary.fetchErrors,0);assert.equal(summary.changed,0);assert.equal(summary.results[0].status,'unchanged');
 const health=JSON.parse(await readFile(stateFile,'utf8')).sources['firenze-rocks'];assert.equal(health.consecutiveFailures,0);assert.equal(health.lastSuccessfulCheck,observed);assert.equal(health.lastSuccessfulExtraction,'2026-09-01T00:00:00Z');
 }finally{await rm(dir,{recursive:true,force:true});}
});
