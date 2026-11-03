import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {validateSource} from '../lib/sources/repository.ts';
const fixture=readFileSync(new URL('./fixtures/official-markup/heavy-weekend-current.html',import.meta.url),'utf8');
const reviewed=JSON.parse(readFileSync(new URL('./fixtures/official-markup/heavy-weekend-reviewed.json',import.meta.url),'utf8'));
const source={festivalSlug:'heavy-weekend',url:'https://www.heavyweekend.live/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'weekly'};
const parse=(h=fixture,overrides={})=>extractFestivalCandidate(h,{...source,...overrides},'2026-11-03T19:22:00Z');
test('real linked logo labels form a registered additive unranked partial announcement, not OCR',()=>{
 const c=parse();assert.equal(validateSource(source),'official_markup:heavy-weekend');
 assert.equal(c.startDate,'2027-06-04');assert.equal(c.endDate,'2027-06-06');assert.deepEqual(c.observedEditionYears,[2027]);
 assert.deepEqual(c.lineup,['Helloween','Falling in reverse','Marilyn Manson']);assert.equal(c.headliners,undefined);
 assert.equal(c.status,'partial');assert.equal(c.artistListMode,'additive');assert.equal(c.lineupScope,'announcement');assert.deepEqual(c.warnings,[]);
 assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,undefined);
 const saved=structuredClone(reviewed),r=evaluateCandidate(saved,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false);assert.deepEqual(saved,reviewed);assert.equal(saved.lineup.length,11);
});
test('later explicit names require provider review, absent acts and confirmed completeness stay preserved',()=>{
 const h=fixture.replaceAll('Helloween',"Later Artist");const c=parse(h);const r=evaluateCandidate({...reviewed,status:'confirmed'},c);
 assert.equal(r.publishable,false);assert.deepEqual(r.reviewReasons,['Agent review required before lineup-triggered provider activity']);
 assert.ok(r.changes.some(x=>x.after==='Later Artist'));assert.ok(!r.changes.some(x=>x.kind.endsWith('_removed')||x.field==='status'));
 const apostrophe=parse(fixture.replace('alt="Helloween"','alt="O\'Brother"'));assert.ok(apostrophe.lineup.includes("O'Brother"));
});
test('future years and contiguous dates are dynamic, mismatches and ambiguous evidence fail closed',()=>{
 const h=fixture.replaceAll('2027','2028').replaceAll('4-5-6 juin','9-10-11 juillet');const c=parse(h,{editionYear:2028});assert.equal(c.startDate,'2028-07-09');assert.equal(c.endDate,'2028-07-11');
 for(const invalid of [h,fixture.replace('Heavy Week-End 2027','Other Festival 2027'),fixture.replaceAll('4-5-6 juin','4-6 juin'),fixture.replaceAll('4-5-6 juin','29-30-31 février'),fixture+'<h2>7-8-9 juin 2027</h2>']){
  assert.deepEqual(parse(invalid).evidence,[]);assert.ok(parse(invalid).warnings.length);
 }
});
test('foreign, credentialed, queried, fragment links and unsupported sources cannot supply names',()=>{
 for(const href of ['https://evil.example/line-up/helloween','https://user@www.heavyweekend.live/line-up/helloween','/line-up/helloween?year=2026','/line-up/helloween#old'])assert.deepEqual(parse(fixture.replace('href="/line-up/helloween"','href="'+href+'"')).evidence,[]);
 for(const url of ['https://evil.example/','https://www.heavyweekend.live/2026','https://user@www.heavyweekend.live/'])assert.deepEqual(parse(fixture,{url}).evidence,[]);
});
test('unknown/image-only artist cards stay actionable; comments, scripts and stock copy are not evidence',()=>{
 for(const invalid of [fixture.replace('alt="Helloween"','alt=""'),fixture.replace('alt="Helloween"','alt="Coming Soon"'),fixture.replace(' src="https://cdn.prod.website-files.com/',' src="https://evil.example/'),fixture+'<a href="/line-up/new-artist"><img alt="" src="https://cdn.prod.website-files.com/new.png"></a>'])assert.deepEqual(parse(invalid).evidence,[]);
 const h='<!--<h2>9-10 juin 2026</h2>--><script><h2>9-10 juin 2026</h2></script>'+fixture+'<p>Sold out! Buy tickets now!</p>';
 assert.deepEqual(parse(h).lineup,parse().lineup);assert.deepEqual(parse(h).warnings,[]);assert.equal(parse(h).ticketStatus,undefined);
});
