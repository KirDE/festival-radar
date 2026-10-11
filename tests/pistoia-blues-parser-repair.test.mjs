import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const html=readFileSync(new URL('./fixtures/pistoia-blues/home-2026.html',import.meta.url),'utf8');
const source={festivalSlug:'pistoia-blues',url:'https://pistoiablues.com/',strategies:['manual_review'],editionYear:2027,refreshPolicy:'weekly',enabled:true};
const parse=(document=html,override={})=>extractFestivalCandidate(document,{...source,...override},'2026-10-10T16:53:00.000Z');
test('actual corrected case: archived concert assets produce unchanged check, no 2027 facts or agent review',()=>{
 const c=parse();const r=evaluateCandidate({slug:'pistoia-blues',editionYear:2027,lineup:[],headliners:[],status:'tba'},c);
 assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false);assert.deepEqual(c.observedEditionYears,[]);
 for(const key of ['startDate','endDate','lineup','headliners','ticketsUrl','ticketStatus','status'])assert.equal(c[key],undefined);
});
test('new edition text, image announcements and undated latest news still request review',()=>{
 for(const document of [html.replace('ptblues26-Fantastic','ptblues27-Fantastic'),html.replace('ptblues26-Fantastic','new-announcement'),html.replace('OBIETTIVO BLUESIN 2026: I VINCITORI','NUOVI ARTISTI ANNUNCIATI'),html.replace('OBIETTIVO BLUESIN 2026: I VINCITORI','PISTOIA BLUES 2027'),html+'<h2>Biglietti 2027 disponibili</h2>',html+'<script type="application/ld+json">{"name":"Pistoia Blues 2027"}</script>']){
  assert.ok(parse(document).warnings.length);assert.equal(parse(document).lineup,undefined);
 }
});
test('changed template, incomplete/error document and untrusted host cannot become successful archived check',()=>{
 for(const document of ['<title>Pistoia Blues</title>Access denied','',html.replaceAll('rsImg','otherImage'),html.replaceAll('title-news','otherTitle'),html.replace('OBIETTIVO BLUESIN 2026: I VINCITORI','OBIETTIVO BLUESIN: I VINCITORI')])assert.ok(parse(document).warnings.length);
 for(const override of [{festivalSlug:'other'},{url:'https://untrusted.test/'},{url:'https://pistoiablues.com/biglietti/'},{editionYear:2026}])assert.ok(parse(html,override).warnings.length);
});
test('later archived edition and benign page changes are semantic, not frozen document hashes',()=>{
 const next=html.replaceAll('2026','2027').replaceAll('ptblues26','ptblues27').replaceAll('Fantastic','Another-act').replace('45°','46°');
 assert.deepEqual(parse(next,{editionYear:2028}).warnings,[]);
 assert.deepEqual(parse(html+'<!-- unrelated formatting revision -->').warnings,[]);
 assert.ok(parse(html.replaceAll('2026','2027')).warnings.length);
});
test('quiet archived check preserves independently verified partial current bill',()=>{
 const current={slug:'pistoia-blues',editionYear:2027,lineup:['Verified support'],headliners:['Verified headliner'],status:'partial',ticketsUrl:'https://pistoiablues.com/biglietti/'};
 const r=evaluateCandidate(current,parse());assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});

test("WordPress menu IDs are not future edition years",()=>assert.deepEqual(parse(html+'<li id="menu-item-2060" class="menu-item-2060">ENG</li>').warnings,[]));

test("entity-encoded and non-slider current edition announcements retain review",()=>{for(const extra of ['<h2>Pistoia Blues &#50;027</h2>','<img src="/wp-content/uploads/2026/10/ptblues27-new.jpg">'])assert.ok(parse(html+extra).warnings.length);});
