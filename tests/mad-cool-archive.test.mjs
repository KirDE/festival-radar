import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const source={festivalSlug:'mad-cool',url:'https://madcoolfestival.es/',editionYear:2027,strategies:['manual_review'],enabled:true,refreshPolicy:'weekly',manualReviewReason:'official home page exposes promotional images but no stable current-edition field markup'};
const at='2026-10-10T16:02:00.000Z';
// Official homepage fetched HTTP 200 on 10 October. News index and lineup
// independently checked: latest news is the August 2026 retrospective.
const html=await readFile(new URL('./fixtures/official-markup/mad-cool-archive-home.html',import.meta.url),'utf8');
test('reviewed official recap is a quiet no-op preserving unknown and verified partial facts',()=>{
  const candidate=extractFestivalCandidate(html,source,at);
  for(const field of ['startDate','endDate','city','lineup','headliners','ticketsUrl','ticketStatus','status'])assert.equal(candidate[field],undefined);
  assert.deepEqual(candidate.warnings,[]);assert.deepEqual(candidate.evidence,[]);assert.deepEqual(candidate.observedEditionYears,[]);
  for(const current of [{slug:'mad-cool',editionYear:2027,status:'tba',ticketStatus:'unknown',lineup:[],headliners:[]},{slug:'mad-cool',editionYear:2027,status:'partial',ticketStatus:'available',lineup:['Verified support'],headliners:['Verified headline'],startDate:'2027-07-07',endDate:'2027-07-10',ticketsUrl:'https://madcoolfestival.es/tickets'}]){
    const result=evaluateCandidate(current,candidate);assert.deepEqual(result.changes,[]);assert.deepEqual(result.reviewReasons,[]);
  }
});
test('unrelated template edits do not require the exact document hash',()=>{
  assert.deepEqual(extractFestivalCandidate(html.replace('215,000 ATTENDEES','216,000 ATTENDEES').replace('1385011913','new-style-version').replace('global.css?1448074335','global.css?2027123456'),source,at).warnings,[]);
});
test('future edition text, links, metadata and image-only artwork keep manual review',()=>{
  for(const changed of [html+'<h2>Mad Cool 2027 first bands</h2>',html.replace('#MadCool2026','#MadCool2027'),html+'<script type="application/json">{"edition":2027}</script>',html+'<a href="/tickets-2028">Tickets</a>',html.replace('a71191478886f202.jpg','new-edition-poster.jpg'),html.replace('class="video-yt-container w-100"','class="video-yt-container w-100"><img src="/first-wave.jpg"'),html.replace('class="video-yt-container w-100"','class="video-yt-container w-100"><iframe src="/new-announcement"></iframe>'),html.replace('class="carousel-item  active"','class="carousel-item active"><img src="/first-wave.jpg"></div><div class="carousel-item"'),html.replace('This was Mad Cool Festival 10th anniversary','First artists announced'),html.replace('mad-cool-festival-2026-tenth-anniversary','first-bands-announced')])assert.match(extractFestivalCandidate(changed,source,at).warnings[0],/Manual review only/);
});
test('missing, invalid or inconsistent archive markers fail closed',()=>{
  for(const changed of [html.replaceAll('THANK YOU!','WELCOME!'),html.replaceAll('#MadCool2026','#MadCool2025'),html.replace('03·08·2026','31·02·2026'),html.replace('02·07·2026','04·08·2026'),html.replace('03·08·2026','03·08·2025'),html.replaceAll('g--main-card__date','unknown'),html.replace('f76b729cc9c2b9ef.jpg','3d153c3cf69ecd76.jpg'),html.replace('carousel-item  active','unknown')])assert.match(extractFestivalCandidate(changed,source,at).warnings[0],/Manual review only/);
});
test('other sources, actual recap edition and non-manual strategies are not bypassed',()=>{
  for(const override of [{festivalSlug:'other'},{editionYear:2026},{url:'https://other.example/'},{url:'https://madcoolfestival.es/line-up'},{url:'http://madcoolfestival.es/'},{fetchUrl:'https://madcoolfestival.es/noticias'},{followLinkPattern:'noticias'}])assert.match(extractFestivalCandidate(html,{...source,...override},at).warnings[0],/Manual review only/);
  assert.ok(extractFestivalCandidate(html,{...source,strategies:['json_ld_event','html_fallback']},at).warnings.length);
});
