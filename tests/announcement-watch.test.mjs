import test from 'node:test';
import assert from 'node:assert/strict';
import {announcementCoverageWarning} from '../lib/ingestion/announcement-watch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const source={festivalSlug:'synthetic-fest',url:'https://festival.example.test/',editionYear:2027,strategies:['html_fallback'],enabled:true,refreshPolicy:'daily'};
const blank={schemaVersion:1,festivalSlug:source.festivalSlug,sourceUrl:source.url,fetchedAt:'2026-11-01T00:00:00Z',observedEditionYears:[],evidence:[],warnings:[]};
const watch=html=>announcementCoverageWarning(html,source,blank);
test('strong edition-bound news and accessible poster announcements wake review, not invented facts',()=>{
 for(const body of ['<h2>First names for 2027 announced!</h2>','<a href="/news/2027-lineup">Line-up is here!</a>','<img alt="Line-up 2027 announced" src="poster.png">','<h2>Erste Bands 2027</h2>']){
  const html='<main>'+body+'</main>';assert.match(watch(html),/Official 2027 lineup announcement detected/);
  const c=extractFestivalCandidate(html,source,blank.fetchedAt);assert.equal(c.headliners,undefined);assert.equal(c.lineup,undefined);assert.ok(evaluateCandidate({slug:source.festivalSlug,editionYear:2027,headliners:[],lineup:[],status:'tba'},c).reviewReasons.some(x=>x.includes('announcement:')));
 }
});
test('archive, navigation, no-announcement, coming-soon, off-origin and next-year content stay quiet',()=>{
 for(const html of ['<nav><a>First names 2027 announced</a></nav>','<footer><h2>First headliner 2027</h2></footer>','<script><h2>First names 2027 announced</h2></script>','<h2>First names 2026 announced</h2>','<h2>First names 2028 announced</h2>','<h2>Line-up 2027 coming soon</h2>','<h2>First headliner 2027 will be announced</h2>','<h2>First headliner 2027 to be announced soon</h2>','<a href="https://evil.test/2027">First names announced</a>','<h2>First names 2027 archive 2026</h2>','<h2>Line-up 2027</h2>'])assert.equal(watch('<main>'+html+'</main>'),undefined,html);
});
test('recognized artist fields suppress the coverage alert; harmless whitespace and duplicate cards have stable keys',()=>{
 const html='<main><h2>First names 2027 announced!</h2></main>';
 assert.equal(announcementCoverageWarning(html,source,{...blank,headliners:['Known Act'],evidence:[{field:'headliners',sourceUrl:source.url,observedAt:blank.fetchedAt}]}),undefined);
 assert.match(announcementCoverageWarning(html,source,{...blank,headliners:[],evidence:[{field:'headliners',sourceUrl:source.url,observedAt:blank.fetchedAt}]}),/parser review required/);
 assert.equal(announcementCoverageWarning(html,source,{...blank,status:'partial',evidence:[{field:'status',sourceUrl:source.url,observedAt:blank.fetchedAt}]}),undefined);
 assert.equal(watch(html),watch('<main><h2>First  names 2027 announced!</h2><h2>First names 2027 announced!</h2></main>'));
 assert.notEqual(watch(html),watch('<main><h2>More names 2027 announced!</h2></main>'));
});
test('nested heading anchors retain same-origin validation before accepting their title or poster',()=>{
 for(const body of ['<h2><a href="https://other.example/2027">First names 2027 announced!</a></h2>','<h2><a href="https://other.example/2027"><img alt="First names 2027 announced!" src="poster.png"></a></h2>','<h2><a href="javascript:alert(2027)">First headliner 2027</a></h2>'])assert.equal(watch('<main>'+body+'</main>'),undefined);
 assert.match(watch('<main><h2><a href="/news/2027-first-names">First names announced!</a></h2></main>'),/parser review required/);
});
