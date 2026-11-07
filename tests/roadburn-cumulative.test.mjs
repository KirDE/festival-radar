import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';import {evaluateCandidate} from '../lib/ingestion/policy.ts';import {roadburnDocuments,ROADBURN_ARTIST_REVIEW} from '../lib/ingestion/adapters/roadburn.ts';
const url='https://roadburn.com/iron-lung-steroid-rhododendron-and-parts-labor-added-to-the-line-up/';
const html=readFileSync(new URL('./fixtures/roadburn-cumulative-2027.html',import.meta.url),'utf8');
const home='<p>The festival will take place in, Tilburg, The Netherlands between April 15-18, 2027</p>';
const source={festivalSlug:'roadburn',url:'https://roadburn.com/',editionYear:2027,strategies:['json_ld_event','html_fallback'],enabled:true,refreshPolicy:'every_3_days'};
const parse=(h=html,s=source)=>extractFestivalCandidate(roadburnDocuments(home,[{url,html:h}],''),s,'2026-11-07T13:22:22Z');
const names=['Antropoceno','Emma Ruth Rundle','IAN','Iron Lung','Kulk','Neurosis','Parts & Labor','Rhododendron','Sadness','Steröid','Trhä','Violencia'];
test('actual current cumulative roster parses all twelve linked acts, no album/day/sidebar or inferred billing',()=>{
 const c=parse();assert.deepEqual(c.lineup,names);assert.deepEqual(c.warnings,[ROADBURN_ARTIST_REVIEW]);assert.equal(c.headliners,undefined);assert.equal(c.lineupScope,'announcement');assert.equal(c.status,'partial');
 assert.ok(c.evidence.some(e=>e.field==='lineup'&&e.sourceUrl===url));
});
test('new five are gated; reviewed replay preserves previous acts, billing and completeness',()=>{
 const c=parse(),cur={slug:'roadburn',editionYear:2027,startDate:c.startDate,endDate:c.endDate,status:'partial',headliners:[],lineup:names.filter(n=>!['Iron Lung','Parts & Labor','Rhododendron','Steröid','Violencia'].includes(n))};
 const r=evaluateCandidate(cur,c);assert.equal(r.changes.length,5);assert.equal(r.publishable,false);assert.deepEqual(r.reviewReasons,[ROADBURN_ARTIST_REVIEW]);
 const replay=evaluateCandidate({...cur,status:'confirmed',headliners:['Neurosis'],lineup:[...names.filter(n=>n!=='Neurosis'),'Later Verified']},c);assert.deepEqual(replay.changes,[]);assert.deepEqual(replay.reviewReasons,[]);
});
test('later additions/year work without frozen artist or document allowlist',()=>{
 const later=html.replace('</ul>','<li><h5><a href="https://roadburn.com/band/later-act/">Later Act</a> — Friday</h5></li></ul>');assert.ok(parse(later).lineup.includes('Later Act'));
 assert.ok(parse(html.replaceAll('2027','2028').replaceAll('2026','2027'),{...source,editionYear:2028}).lineup.includes('Iron Lung'));
});
test('old edition, cancellation, changed section and broken canonical remain unaccepted',()=>{
 for(const h of [html.replaceAll('2027','2026'),html.replace('Roadburn 2027','Roadburn 2027 cancelled'),html.replace('Here’s where we’re at so far','Related artists'),html.replace('rel="canonical"','rel="alternate"')])assert.equal(parse(h).lineup,undefined);
});
test('off-origin, unlinked, hidden and sidebar assertions cannot enter roster',()=>{
 const h=html.replace('https://roadburn.com/band/iron-lung/','https://evil.invalid/band/iron-lung/').replace('<h5><a href="https://roadburn.com/band/steroid/"','<h5 hidden><a href="https://roadburn.com/band/steroid/"')+'<h5><a href="https://roadburn.com/band/fake/">Fake</a> — Friday</h5>';
 const c=parse(h);assert.ok(!c.lineup.includes('Iron Lung'));assert.ok(!c.lineup.includes('Steröid'));assert.ok(!c.lineup.includes('Fake'));
});
