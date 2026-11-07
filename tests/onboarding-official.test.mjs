import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {validateSource} from '../lib/sources/repository.ts';
for(const [slug,url,count,start,end] of [['vainstream','https://vainstream.com/artists/',2,'2027-06-25','2027-06-26'],['rock-the-lakes','https://www.rockthelakes.ch/artistes-2027/',1,'2027-08-20','2027-08-22']]) {
 const html=readFileSync(new URL(`./fixtures/official-markup/${slug}-excerpt.html`,import.meta.url),'utf8');
 const source={festivalSlug:slug,url,editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'weekly'};
 const parse=(h=html,s={})=>extractFestivalCandidate(h,{...source,...s},'2026-11-07T15:00:00Z');
 test(`${slug}: registered adapter extracts current unranked dated announcement`,()=>{const c=parse();assert.equal(validateSource(source),'official_markup:'+slug);assert.equal(c.lineup.length,count);assert.equal(c.startDate,start);assert.equal(c.endDate,end);assert.equal(c.headliners,undefined);assert.equal(c.artistListMode,'additive');assert.deepEqual(c.warnings,[])});
 test(`${slug}: wrong edition, identity, missing dates, truncated HTML fail closed`,()=>{
  for(const [h,s]of [[html,{editionYear:2028}],[html,{url:'https://evil.test/'}],[html.replaceAll('2027','2026'),{}],[html.replace('</main>',''),{}],[html.replace(/Juni|August/g,'Unknown'),{}]])assert.deepEqual(parse(h,s).evidence,[]);
 });
 test(`${slug}: replay preserves saved headline rank, confirmed status and omitted names; new official acts use normal ingestion`,()=>{
  const c=parse(),current={slug,editionYear:2027,startDate:start,endDate:end,status:'confirmed',headliners:[c.lineup[0]],lineup:[...c.lineup.slice(1),'Preserved Artist'],city:'City',ticketsUrl:'https://tickets.test/'};
  assert.deepEqual(evaluateCandidate(current,c).changes,[]);assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);
  const later={...c,lineup:[...c.lineup,'Later Artist']};const r=evaluateCandidate(current,later);assert.equal(r.publishable,true);assert.deepEqual(r.reviewReasons,[]);assert.ok(!r.changes.some(x=>x.kind.endsWith('_removed')));
 });
 test(`${slug}: corroborated date move remains visible for review`,()=>{const changed=slug==='vainstream'?html.replace('25.-26. Juni','18.-19. Juni'):html.replaceAll('20 ● 21 ● 22','13 ● 14 ● 15');assert.notEqual(parse(changed).startDate,start)});
}
test('Vainstream rejects off-origin artist identity and missing label',()=>{let h=readFileSync(new URL('./fixtures/official-markup/vainstream-excerpt.html',import.meta.url),'utf8');const s={festivalSlug:'vainstream',url:'https://vainstream.com/artists/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'weekly'};for(const altered of [h.replaceAll('https://vainstream.com/projects/','https://evil.test/projects/'),h.replaceAll('ALICE STARK','')])assert.deepEqual(extractFestivalCandidate(altered,s,'2026-11-07').evidence,[])});
test('artist listing transport rejects identity redirects and fetch overrides',async()=>{
 const {fetchSource}=await import('../lib/ingestion/fetch.ts');
 const s={festivalSlug:'vainstream',url:'https://vainstream.com/artists/',editionYear:2027,strategies:['official_markup'],enabled:true,refreshPolicy:'weekly'};
 const response=(url)=>{const r=new Response('official');Object.defineProperty(r,'url',{value:url});return r};
 await assert.rejects(fetchSource(s,{fetchImpl:async()=>response('https://evil.test/artists/')}),/identity/);
 await assert.rejects(fetchSource({...s,fetchUrl:'https://evil.test/'},{fetchImpl:async()=>response(s.url)}),/identity/);
 assert.equal((await fetchSource(s,{fetchImpl:async()=>response(s.url)})).response.status,200);
});
