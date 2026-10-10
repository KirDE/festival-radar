import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const source={festivalSlug:'full-force',url:'https://full-force.de/',editionYear:2027,strategies:['manual_review'],enabled:true,refreshPolicy:'weekly',manualReviewReason:'official home page exposes a stale 2024 Event and no trustworthy current-edition dates'};
const at='2026-10-10T13:00:00.000Z';
const current={slug:'full-force',editionYear:2027,lineup:[],headliners:[],status:'tba',ticketStatus:'unknown',city:'Ferropolis'};
const fixtures=await Promise.all(['home','english'].map(n=>readFile(new URL(`./fixtures/official-markup/full-force-archive-${n}.html`,import.meta.url),'utf8')));
for(const [i,html] of fixtures.entries())test(`real ${i?'English':'German'} archive is a quiet no-op, never old dates/artists/tickets`,()=>{
  const candidate=extractFestivalCandidate(html,source,at);
  for(const field of ['startDate','endDate','city','lineup','headliners','ticketsUrl','ticketStatus','status'])assert.equal(candidate[field],undefined);
  assert.deepEqual(candidate.warnings,[]);assert.deepEqual(candidate.evidence,[]);assert.deepEqual(candidate.observedEditionYears,[]);
  for(const catalog of [current,{...current,lineup:['Verified support'],headliners:['Verified headline'],status:'partial'}]){
    const result=evaluateCandidate(catalog,candidate);assert.deepEqual(result.changes,[]);assert.deepEqual(result.reviewReasons,[]);
  }
});
const html=fixtures[0];
test('later archive editions do not rely on hardcoded year or document hash',()=>{
  assert.deepEqual(extractFestivalCandidate(html.replaceAll('2024','2025'),source,at).warnings,[]);
});
test('current or future announcement retains review even when all old data remain',()=>{
  for(const changed of [html.replaceAll('2024','2027'),html+'<h2>Full Force 2027 first bands</h2>',html.replace('"route_identifier": "fullforce2024"','"route_identifier": "fullforce2024", "news": "Full Force 2027 first acts"'),html+'<a href="/updates/full-force-2028">Next edition</a>']){
    assert.match(extractFestivalCandidate(changed,source,at).warnings[0],/Manual review only/);
  }
});
test('ambiguous, broken, or conflicting markers fail closed',()=>{
  for(const changed of [html.replace('21. - 23. Juni 2024','21. - 23. Juni 2025'),html.replace('id="__NEXT_DATA__"','id="unknown"'),html.replace('"published": true','"published": false'),html.replace('"@type": "Festival"','"@type": "MusicEvent"'),html.replace('"startDate": "2024','"startDate": "2025'),html.replace('Ferropolis, Germany','Elsewhere'),html.replace('"props":','INVALID:'),html.replace('"name": "FULL FORCE Festival"','INVALID:'),html.replace('</body>','<p>21. - 23. Juni 2024</p><p>Ferropolis, Germany</p></body>')]){
    assert.match(extractFestivalCandidate(changed,source,at).warnings[0],/Manual review only/);
  }
});
test('unrelated festivals and non-home official URLs remain manual review',()=>{
  for(const override of [{festivalSlug:'other'},{url:'https://other.example/'},{url:'https://full-force.de/en/updates/old-announcement'},{url:'http://full-force.de/'}])assert.match(extractFestivalCandidate(html,{...source,...override},at).warnings[0],/Manual review only/);
});
test('normal generic strategies are not silently bypassed',()=>{
  assert.ok(extractFestivalCandidate(html,{...source,strategies:['json_ld_event','html_fallback']},at).warnings.length);
});
