import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parserSource } from './support/parser-source.ts';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { fetchSource } from '../lib/ingestion/fetch.ts';
import { copenhellNews, COPENHELL_REVIEW } from '../lib/ingestion/adapters/copenhell-current.ts';
const source = parserSource('copenhell', { url: 'https://copenhell.dk/faith-no-more-headline-copenhell-2027/' });
const fixture = JSON.parse(await readFile(new URL('./fixtures/official-markup/copenhell-current-2027.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(fixture);
const extract = (data = fixture, s = source) => extractFestivalCandidate(JSON.stringify(data), s, '2026-10-11T09:00:00Z');
const expected = ['PIERCE THE VEIL','LYNYRD SKYNYRD','BAEST','AMON AMARTH','I PREVAIL','CLUTCH','MOTIONLESS IN WHITE','ORBIT CULTURE','STATIC-X','FU MANCHU','GWAR','WATAIN','KANONENFIEBER','ASHES OF BILLY',"Humanity's Last Breath",'THE BARBARIANS OF CALIFORNIA','Angel Du$t','HAYWIRE','RAUNCHY','COLD CULTURE','BRUTUS','COILGUNS','GUTTURAL DISGORGE','LADRONES','KRØYER','PINTGLASS','KING YOSEF','ONDT BLOD','BLOODSTAIN','TEAR DUNGEON','BAD BREEDING','SUNKEN','CROCELL','BABE HAVEN','FERAL NATURE','DREAD WITCH','VIDNET'];
const current = { slug:'copenhell',editionYear:2027,startDate:'2027-06-23',endDate:'2027-06-26',status:'partial',headliners:['Faith No More','Judas Priest','D-A-D'],lineup:expected,ticketsUrl:'https://copenhell.dk/billetter/',ticketStatus:'available' };
const sorted = ns => ns.map(n=>n.toLowerCase()).sort();
test('real 8/9 October correction: 40 acts, explicit three headliners, partial bill and four-day sales', () => {
 const c = extract(); assert.deepEqual(sorted(c.lineup),sorted(expected));assert.deepEqual(sorted(c.headliners),sorted(current.headliners));
 for (const f of ['startDate','endDate','status','ticketsUrl','ticketStatus']) assert.equal(c[f],current[f]);
 assert.equal(c.artistListMode,'additive');assert.equal(c.lineupScope,'announcement');assert.deepEqual(c.observedEditionYears,[2027]);
 assert.ok(c.evidence.some(e=>e.field==='headliners'&&e.sourceUrl.includes('d-a-d-bliver')));
 assert.ok(c.evidence.some(e=>e.field==='lineup'&&e.sourceUrl.endsWith('/program/')));
 assert.ok(c.evidence.some(e=>e.field==='ticketStatus'&&e.sourceUrl.includes('billetsalget')));
 assert.deepEqual(evaluateCandidate(current,c).changes,[]);assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);
});
test('new artists remain review-gated; unknown billing is not guessed from list order',()=>{
 const result=evaluateCandidate({...current,lineup:[],headliners:[]},extract());assert.ok(result.reviewReasons.includes(COPENHELL_REVIEW));assert.equal(result.publishable,false);
 const data=clone();const doc=data.documents.find(d=>d.url.endsWith('/billetsalget-til-2027-er-aabent/'));doc.html=doc.html.replace('FAITH NO MORE &#8211; JUDAS PRIEST','JUDAS PRIEST &#8211; FAITH NO MORE');assert.deepEqual(extract(data).headliners,extract().headliners);
});
test('later programme additions are supported, but never remove verified partial acts or downgrade full bills',()=>{
 const data=clone();const program=data.documents.find(d=>d.url.endsWith('/program/'));
 // Add inside music grid, before its closing partial-state marker.
 program.html=program.html.replace('</div>Musikprogrammet','<div class="grid-item musik Musik"><a href="https://copenhell.dk/artist/later-band/"><h3>LATER BAND</h3></a></div></div>Musikprogrammet');
 const c=extract(data);assert.ok(c.lineup.includes('LATER BAND'));assert.ok(evaluateCandidate(current,c).reviewReasons.includes(COPENHELL_REVIEW));
 const preserved=evaluateCandidate({...current,status:'confirmed',lineup:[...current.lineup,'Previously verified']},extract());assert.deepEqual(preserved.changes,[]);assert.deepEqual(preserved.reviewReasons,[]);
});
test('later edition works without frozen title, timestamp, bill or hash',()=>{
 const data=JSON.parse(JSON.stringify(fixture).replaceAll('2027','2028').replaceAll('2026','2027'));
 const c=extract(data,{...source,url:source.url.replace('2027','2028'),editionYear:2028});assert.equal(c.startDate,'2028-06-23');assert.equal(c.ticketStatus,'available');assert.equal(c.headliners.length,3);assert.equal(c.lineup.length,37);
});
test('programme drift, stale edition, unknown artist identity and sold-out pass cannot silently overwrite corrections',()=>{
 const drift=clone();drift.documents.find(d=>d.url.endsWith('/program/')).html=drift.documents.find(d=>d.url.endsWith('/program/')).html.replace(/(<h3\b[^>]*>)BAEST(<\/h3>)/,'$1ARCHIVED BAND$2');assert.equal(extract(drift).lineup,undefined);assert.match(extract(drift).warnings.join(),/disagree/);
 const identity=clone();identity.documents=identity.documents.filter(d=>!d.url.includes('/artist/'));assert.match(extract(identity).warnings.join(),/identity/);
 const sold=clone();sold.documents.find(d=>d.url.endsWith('/billetter/')).html=sold.documents.find(d=>d.url.endsWith('/billetter/')).html.replace('Køb nu','Udsolgt');assert.equal(extract(sold).ticketStatus,undefined);
 const stale=extract(fixture,{...source,editionYear:2028});assert.equal(stale.lineup,undefined);assert.equal(stale.ticketStatus,undefined);
});
test('activity cards, footer and off-origin documents are not musician or festival evidence',()=>{
 const data=clone();const program=data.documents.find(d=>d.url.endsWith('/program/'));program.html=program.html.replace('</div>Musikprogrammet','<div class="grid-item aktivitet"><a href="https://copenhell.dk/artist/not-music/"><h3>NOT MUSIC</h3></a></div></div>Musikprogrammet');assert.deepEqual(extract(data).lineup,extract().lineup);
 const unsafe=clone();unsafe.documents.push({url:'https://evil.example/program/',html:'<main>2027</main>'});assert.deepEqual(extract(unsafe).evidence,[]);
});
test('live fetch discovers current links, preserves existing source URL, verifies biography, never contacts providers',async()=>{
 const calls=[];const response=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{calls.push(url);const doc=fixture.documents.find(d=>d.url===url);assert.ok(doc,url);return new Response(doc.html);}});
 assert.equal(response.response.status,200);assert.equal(calls.length,7);assert.deepEqual(extractFestivalCandidate(await response.response.text(),source,'now').lineup,extract().lineup);assert.ok(calls.every(url=>url.startsWith('https://copenhell.dk/')));
 const home=fixture.documents.find(d=>d.url==='https://copenhell.dk/');assert.equal(copenhellNews(home.html,2027).length,3);assert.deepEqual(copenhellNews(home.html,2028),[]);
});
test('HTTP403 on a required linked official document remains a source failure, not a completed parse',async()=>{
 const result=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>url.endsWith('/program/')?new Response('Forbidden',{status:403}):new Response(fixture.documents.find(d=>d.url===url).html)});assert.equal(result.response.status,403);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async()=>{const r=new Response('<main></main>');Object.defineProperty(r,'url',{value:'https://evil.example/'});return r;}}),/redirected/);
});
test('newly linked headliner announcement is parsed by explicit prose, not a frozen three-name bill',()=>{
 const data=clone();const template=data.documents.find(d=>d.url.includes('d-a-d-bliver'));const later={url:'https://copenhell.dk/later-band-bliver-fjerde-headliner-paa-copenhell-2027/',html:template.html.replaceAll('D-A-D','LATER BAND').replaceAll('TREDJE','FJERDE').replaceAll('tredje','fjerde').replaceAll('2026-10-08','2026-11-08')};data.documents.push(later);
 data.documents.find(d=>d.url==='https://copenhell.dk/').html=data.documents.find(d=>d.url==='https://copenhell.dk/').html.replace('</main>',`<a href="${later.url}"><h2>LATER BAND BLIVER FJERDE HEADLINER PÅ COPENHELL 2027</h2></a></main>`);
 const program=data.documents.find(d=>d.url.endsWith('/program/'));program.html=program.html.replace('</div>Musikprogrammet','<div class="grid-item musik Musik"><a href="https://copenhell.dk/artist/later-band/"><h3>LATER BAND</h3></a></div></div>Musikprogrammet');
 const c=extract(data);assert.ok(c.headliners.includes('LATER BAND'));assert.ok(!c.lineup.includes('LATER BAND'));assert.ok(copenhellNews(data.documents.find(d=>d.url==='https://copenhell.dk/').html,2027).includes(later.url));assert.ok(evaluateCandidate(current,c).reviewReasons.includes(COPENHELL_REVIEW));
});
