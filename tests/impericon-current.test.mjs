import test from 'node:test';
import assert from 'node:assert/strict';
import { impericonFixture, impericonCurrentSource as source } from './support/impericon-current.ts';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { fetchSource } from '../lib/ingestion/fetch.ts';
import { discoverImpericonAnnouncements } from '../lib/ingestion/adapters/impericon-current.ts';
const at='2026-10-18T15:00:00Z';
const current={slug:'impericon',editionYear:2027,startDate:'2027-06-25',endDate:'2027-06-26',status:'partial',headliners:['Sample Artist'],lineup:['Support One']};
const extract=(e=impericonFixture(),s=source)=>extractFestivalCandidate(JSON.stringify(e),s,at);
const reject=e=>{const c=extract(e);assert.equal(c.headliners,undefined);assert.equal(evaluateCandidate(current,c).publishable,false);assert.match(c.warnings.join(),/no trustworthy/);};
test('new headliner is discovered without changing a fixed post/name list; songs and merchandise are excluded',()=>{
 const c=extract();assert.deepEqual(c.headliners,['Beartooth','Sample Artist']);assert.deepEqual(c.lineup,['Support One']);assert.deepEqual(c.warnings,[]);
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes.map(c=>[c.kind,c.after]),[['headliner_added','Beartooth']]);assert.equal(r.publishable,true);
 assert.deepEqual(extract(impericonFixture('Future Collective')).headliners,['Future Collective','Sample Artist']);
});
test('additive announcement does not remove earlier acts when older posts rotate out of listing',()=>{
 const e=impericonFixture();e.home=e.home.replace(/<a href="[^"]+-new-line-up-wave">[^<]+<\/a>/,'');e.articles.splice(1,1);
 const r=evaluateCandidate({...current,lineup:['Support One','Previously Confirmed']},extract(e));assert.ok(!r.changes.some(c=>c.kind.endsWith('_removed')));
});
test('successful unchanged check is quiet; changed dates and known billing promotions require review',()=>{
 const c=extract();assert.deepEqual(evaluateCandidate({...current,headliners:c.headliners},c).changes,[]);
 assert.ok(evaluateCandidate(current,extract(impericonFixture('Beartooth','24'))).reviewReasons.some(r=>/date|confirmation/i.test(r)));
 assert.ok(evaluateCandidate({...current,lineup:['Beartooth','Support One']},c).reviewReasons.some(r=>/billing promotion/i.test(r)));
});
test('wrong edition, conflicting dates, incomplete pages and changed article markup fail closed',()=>{
 reject(impericonFixture('Future','25',2026));
 for(const change of [e=>{e.home=e.home.slice(0,-8);},e=>{e.articles[0].html=e.articles[0].html.replace('article__content"','missing"');},e=>{e.articles[0].html=e.articles[0].html.replace('Impericon Festival 2027:','Impericon Festival 2026:');},e=>{e.home=e.home.replace('25/26.06.2027','30/31.02.2027');}]){const e=impericonFixture();change(e);reject(e);}
});
test('unknown announcement and unsafe/noncanonical URLs are not silently treated as unchanged',()=>{
 const e=impericonFixture();e.articles[0].html=e.articles[0].html.replace(/<p>[\s\S]*?<\/p>/,'<p>Unrecognised announcement markup.</p>').replace(/<p>As headliners[\s\S]*?<\/p>/,'').replace(/<p>Our previous[\s\S]*?<\/p>/,'');reject(e);
 const bad=impericonFixture();bad.articles[0].html=bad.articles[0].html.replace('rel="canonical" href="https://www.impericon.com','rel="canonical" href="https://evil.example');reject(bad);
 assert.throws(()=>discoverImpericonAnnouncements(impericonFixture().home.replaceAll('/blogs/festival/','/not-a-blog/'),2027));
});
test('fetch follows only discovered official edition articles and exact same-article blog alias redirects',async()=>{
 const e=impericonFixture();const calls=[];const alias=e.articles[0].url.replace('/festival/','/magazine/');
 const f=async(url,opts)=>{calls.push(url);if(url===source.url)return new Response(e.home);if(url===e.articles[0].url)return new Response('',{status:302,headers:{location:alias}});const d=e.articles.find(d=>d.url===url||url===alias);assert.ok(d);assert.notEqual(opts.redirect,'follow');return new Response(d.html);};
 const result=await fetchSource(source,{fetchImpl:f,maxAttempts:1});assert.equal(result.attempts,5);assert.equal(extractFestivalCandidate(await result.response.text(),source,at).headliners[0],'Beartooth');
 assert.equal(calls.filter(u=>u===source.url).length,1);
 await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=>url===source.url?new Response(e.home):new Response('',{status:302,headers:{location:'https://evil.example/'}})}),/redirected outside/);
});
