import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchRoskildeDocuments, isRoskildeSource, ROSKILDE_REVIEW} from '../lib/ingestion/adapters/roskilde.ts';
const source={festivalSlug:'roskilde',url:'https://www.roskilde-festival.dk/',strategies:['json_ld_event','html_fallback'],refreshPolicy:'daily',enabled:true,editionYear:2027};
const home=await readFile(new URL('./fixtures/roskilde/home.html',import.meta.url),'utf8');
const program=await readFile(new URL('./fixtures/roskilde/program.html',import.meta.url),'utf8');
const news=await readFile(new URL('./fixtures/roskilde/announcement.html',import.meta.url),'utf8');
const documents=[{url:source.url,html:home},{url:source.url+'program',html:program},{url:source.url+'nyheder/rf27-de-foerste-18-navne-er-klar',html:news}];
const extract=(docs=documents,s=source)=>extractFestivalCandidate(JSON.stringify({kind:'roskilde-documents-v1',documents:docs}),s,'2026-11-07T10:00:00Z');
const current={slug:'roskilde',name:'Roskilde',country:'Denmark',countryCode:'DK',editionYear:2027,headliners:[],lineup:[],officialUrl:source.url,status:'tba',ticketStatus:'unknown',updatedAt:'2026-01-01',genres:[]};
test('real official 2027 dates and all18 names; never Ny! or inferred headline billing',()=>{
 const c=extract();assert.equal(c.startDate,'2027-06-26');assert.equal(c.endDate,'2027-07-03');assert.equal(c.lineup.length,18);assert.ok(c.lineup.includes('G Jones B2B Eprom'));assert.ok(c.lineup.includes('Emma Sehested Høeg'));assert.ok(!c.lineup.includes('Ny!'));assert.equal(c.headliners,undefined);assert.equal(c.status,'partial');assert.equal(c.ticketsUrl,source.url+'billetter');assert.deepEqual(c.observedEditionYears,[2027]);assert.equal(c.artistListMode,'additive');
});
test('new unranked additions stay review gated; reviewed replay produces zero changes',()=>{
 const c=extract();assert.ok(evaluateCandidate(current,c).reviewReasons.includes(ROSKILDE_REVIEW));const reviewed={...current,startDate:c.startDate,endDate:c.endDate,status:c.status,ticketsUrl:c.ticketsUrl,lineup:c.lineup};const replay=evaluateCandidate(reviewed,c);assert.deepEqual(replay.changes,[]);assert.deepEqual(replay.reviewReasons,[]);
});
test('reviewed headline billing is not demoted or removed by programme membership',()=>{
 const c=extract();const reviewed={...current,headliners:['Tame Impala'],lineup:['Existing Act']};const r=evaluateCandidate(reviewed,c);assert.ok(!r.changes.some(c=>c.kind.endsWith('_removed')));assert.equal(c.headliners,undefined);
});
for(const [label,mutate] of [
 ['wrong-year',d=>{d[0].html=d[0].html.replaceAll('2027','2026')}],
 ['stale-programme',d=>{d[1].html=d[1].html.replaceAll('2027','2026')}],
 ['missing-announcement',d=>{d.pop()}],
 ['foreign-doc',d=>{d[2].url='https://example.test/nyheder/rf27-fake'}],
 ['duplicate-document',d=>{d.push(d[2])}],
 ['invalid-date',d=>{d[0].html=d[0].html.replace('26/6 – 3/7 2027','31/6 – 3/7 2027')}],
 ['empty-programme',d=>{d[1].html='<h1>Program</h1>'}],
])test(label+' never publishes unverified artist fields',()=>{const d=structuredClone(documents);mutate(d);const c=extract(d);assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);});
test('future/current added card is gated until matched by official edition announcement',()=>{const d=structuredClone(documents);d[1].html=d[1].html.replace('</main>','<a href="/program/musik/new-act"><h2>New Act</h2></a></main>');const c=extract(d);assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);});
test('other festival/host/transport configuration never selects scoped Python helper',()=>{assert.equal(isRoskildeSource({...source,festivalSlug:'other'}),false);assert.equal(isRoskildeSource({...source,url:'https://example.test/'}),false);assert.equal(isRoskildeSource({...source,fetchUrl:'https://example.test/'}),false);});
test('invalid helper year fails before launching any process',async()=>{await assert.rejects(fetchRoskildeDocuments(2027.5));});
