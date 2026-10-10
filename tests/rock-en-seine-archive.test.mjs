import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const html=await readFile(new URL('./fixtures/official-markup/rock-en-seine-archive.html',import.meta.url),'utf8');
const source={festivalSlug:'rock-en-seine',url:'https://www.rockenseine.com/',editionYear:2027,strategies:['json_ld_event','html_fallback'],enabled:true,refreshPolicy:'weekly'};
const observedAt='2026-10-10T12:50:00.000Z';
const current={slug:source.festivalSlug,editionYear:2027,lineup:[],headliners:[],status:'tba',ticketStatus:'unknown',city:'Saint-Cloud'};
test('real archived hero and title reject old tickets and artists despite academic 2026-2027',()=>{
  const candidate=extractFestivalCandidate(html,source,observedAt);
  assert.equal(candidate.ticketsUrl,undefined);
  assert.equal(candidate.lineup,undefined);
  assert.deepEqual(candidate.evidence,[]);
  assert.deepEqual(candidate.warnings,[]);
  const result=evaluateCandidate(current,candidate);
  assert.deepEqual(result.changes,[]);
  assert.deepEqual(result.reviewReasons,[]);
  const populated=evaluateCandidate({...current,lineup:['Verified support'],headliners:['Verified headliner'],status:'partial'},candidate);
  assert.deepEqual(populated.changes,[]);
  assert.deepEqual(populated.reviewReasons,[]);
});
test('archive recognition follows later editions without pinning a document hash or year',()=>{
  const updated=html.replaceAll('2026','2027');
  const candidate=extractFestivalCandidate(updated,{...source,editionYear:2028},observedAt);
  assert.deepEqual(candidate.evidence,[]);
  assert.deepEqual(candidate.warnings,[]);
});
test('current hero is no longer an archive and allows later explicit fields',()=>{
  const updated=html.replaceAll('2026','2027')+'<meta name="festival:start_date" content="2027-08-25">';
  const candidate=extractFestivalCandidate(updated,source,observedAt);
  assert.equal(candidate.startDate,'2027-08-25');
  assert.equal(candidate.ticketsUrl,'https://www.rockenseine.com/billetterie/');
});
test('current JSON-LD Event wins over stale archive metadata',()=>{
  const updated=html+'<script type="application/ld+json">'+JSON.stringify({'@type':'MusicEvent',startDate:'2027-08-25',endDate:'2027-08-29'})+'</script>';
  const candidate=extractFestivalCandidate(updated,source,observedAt);
  assert.equal(candidate.startDate,'2027-08-25');
  assert.ok(candidate.observedEditionYears.includes(2027));
  assert.equal(candidate.ticketsUrl,undefined);
  assert.equal(candidate.lineup,undefined);
  assert.deepEqual(candidate.warnings,[]);
});
test('conflicting or missing hero does not suppress extraction or review',()=>{
  for(const updated of [html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/,'<h1>Festival Rock en Seine - Du 25 au 29 août 2027</h1>'),html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/,'')]) {
    const candidate=extractFestivalCandidate(updated,source,observedAt);
    assert.ok(candidate.warnings.length>0);
    assert.equal(candidate.ticketsUrl,'https://www.rockenseine.com/billetterie/');
  }
});
test('the source-specific archive rule does not suppress other festivals',()=>{
  const candidate=extractFestivalCandidate(html,{...source,festivalSlug:'other-festival'},observedAt);
  assert.equal(candidate.ticketsUrl,'https://www.rockenseine.com/billetterie/');
});

test('explicit manual-review configuration retains its review boundary',()=>{
  const candidate=extractFestivalCandidate(html,{...source,strategies:['manual_review'],manualReviewReason:'Requires manual approval'},observedAt);
  assert.match(candidate.warnings[0],/Manual review only/);
});
