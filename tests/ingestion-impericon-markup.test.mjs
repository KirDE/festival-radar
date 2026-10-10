import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {sourceParserKey} from '../lib/sources/repository.ts';
import {impericonAnnouncementUrl as url} from '../lib/ingestion/adapters/impericon.ts';

const names=['Fit For A King','Silverstein','The Amity Affliction','Wage War','From Ashes To New','Blood For Blood','Speed','Bodysnatcher'];
const source={festivalSlug:'impericon',url,editionYear:2027,strategies:['official_markup'],refreshPolicy:'daily',enabled:true};
// Synthetic closed document: no scraped page, image bytes or catalogue seed.
const fixture=`<!doctype html><html><head><meta property="og:url" content="${url}"><meta property="og:title" content="Impericon Festival 2027: New Line-Up Drop!"><meta property="og:type" content="article"><link rel="canonical" href="${url}"></head><body>
<nav><b>Unrelated merchandise artist</b></nav><h1>Impericon Festival 2027: New Line-Up Drop!</h1>
<div class="article__content"><div class="rte">
<p>You already know our headliners for <a href="https://www.impericon.com/pages/festival">Impericon Festival 2027</a> – but today, <a href="https://www.impericon.com/collections/lorna-shore"><strong>Lorna Shore</strong></a> are finally getting some company on the lineup poster. We are excited to announce eight more bands for the next edition of the festival!</p>
<p>Officially joining the bill: ${names.map(n=>`<b>${n}</b> – synthetic biography.`).join(' ')}</p>
<p>More acts will follow – find tickets below!</p><div><img alt="Synthetic poster"></div>
<h2>Ticket Status: Tier 2 Tickets</h2><p>Weekend passes are available, VIP upgrades are sold out.</p>
<p>Order tickets</p><p><img alt="Synthetic tickets"></p><p>More updates</p>
</div></div><div class="article__content about-author-wrapper"><b>Author favourite artist</b></div>
<span class="product-meta__title heading h3"><a href="/products/25-26-06-2027-2-preisstufe-weekend-ticket">25/26.06.2027 2. Preisstufe - Weekend Ticket</a></span>
<footer>Festival 2026, other artists</footer></body></html>`;
const at='2026-10-10T08:00:00Z';
const current={slug:'impericon',editionYear:2027,startDate:'2027-06-25',endDate:'2027-06-26',status:'partial',headliners:['Lorna Shore'],lineup:['Fit for a King',...names.slice(1)],ticketStatus:'available'};
const extract=(html=fixture,overrides={})=>extractFestivalCandidate(html,{...source,...overrides},at);
function rejected(html,overrides){
 const c=extract(html,overrides);assert.deepEqual(c.evidence,[]);assert.equal(c.lineup,undefined);
 assert.equal(evaluateCandidate(current,c).publishable,false);
 assert.deepEqual(evaluateCandidate(current,c).changes,[]); // never mass-removes
 assert.match(c.warnings.join(' '),/no trustworthy fields/);
}
test('registered dated source extracts actual billing and names, with no stale ticket claims',()=>{
 assert.equal(sourceParserKey(source),'official_markup:impericon');const c=extract();
 assert.deepEqual(c.lineup,names);assert.deepEqual(c.headliners,['Lorna Shore']);assert.equal(c.status,'partial');
 assert.equal(c.startDate,'2027-06-25');assert.equal(c.endDate,'2027-06-26');assert.deepEqual(c.observedEditionYears,[2027]);
 assert.equal(c.ticketStatus,undefined);assert.equal(c.city,undefined);assert.deepEqual(c.warnings,[]);
 assert.deepEqual(c.evidence.map(e=>e.field),['startDate','endDate','headliners','lineup','status']);
 assert.ok(c.evidence.every(e=>e.sourceUrl===url&&e.observedAt===at));
});
test('matching current DB names (case insensitive) produce zero changes and provider work',()=>{
 const r=evaluateCandidate(current,extract());assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false);
});
test('only reviewed post and configured year are allowed',()=>{
 for(const u of [url+'?year=2026',url+'/',url.replace('2027','2028'),'https://www.impericon.com/pages/festival',url.replace('impericon.com','evil.example')])rejected(fixture,{url:u});
 for(const year of [2026,2028,undefined])rejected(fixture,{editionYear:year});
});
test('canonical and OG identity must be unique and edition-consistent',()=>{
 for(const property of ['og:url','og:title','og:type']){
  const tag=fixture.match(new RegExp(`<meta property="${property}"[^>]*>`))[0];rejected(fixture.replace(tag,''));rejected(fixture.replace(tag,tag+tag));
 }
 rejected(fixture.replace('content="article"','content="website"'));
 rejected(fixture.replace('rel="canonical"','rel="alternate"'));
 rejected(fixture.replaceAll('Festival 2027','Festival 2026'));
});
test('dated announcement does not accept changed or conflicting dates',()=>{
 rejected(fixture.replace('25/26.06.2027','24/26.06.2027'));
 rejected(fixture.replace('25-26-06-2027','25-26-06-2028'));
 rejected(fixture.replace('25/26.06.2027','25/26.06.2026'));
 rejected(fixture.replace('product-meta__title','unrelated-title'));
});
test('new acts, extra artist blocks, removals and duplicate names fail closed',()=>{
 rejected(fixture.replace('<b>Speed</b>','<b>New Artist</b>'));
 rejected(fixture.replace('<b>Speed</b>','<b>Speed</b><b>Extra Artist</b>'));
 rejected(fixture.replace('<b>Speed</b>',''));
 rejected(fixture.replace('<b>Speed</b>','<b>Bodysnatcher</b>'));
 rejected(fixture.replace('<p>More updates</p>','<p><b>Extra Artist</b></p>'));
 rejected(fixture.replace('<p>More updates</p>','<p>More updates</p><p>Extra announcement</p>'));
});
test('missing, duplicate, truncated or malformed article must not borrow other page content',()=>{
 rejected(fixture.slice(0,-15));rejected(fixture.replace('class="article__content"','class="unknown"'));
 rejected(fixture.replace('</div></div>','</div>'));
 rejected(fixture.replace('<b>Speed</b>','<b>Speed'));
 rejected(fixture.replace('<div class="article__content">','<div class="article__content"></div><div class="article__content">'));
 rejected(fixture.replace('<h1>Impericon Festival 2027: New Line-Up Drop!</h1>',''));
});
test('explicit headliner anchor and partial-announcement evidence are required',()=>{
 rejected(fixture.replace('our headliners','our artists'));
 rejected(fixture.replace('/collections/lorna-shore','/collections/other'));
 rejected(fixture.replace('More acts will follow – find tickets below!','Full lineup announced!'));
});
test('manual source remains inert until explicitly activated',()=>{
 const c=extract(fixture,{strategies:['manual_review']});assert.deepEqual(c.evidence,[]);assert.equal(c.lineup,undefined);assert.equal(evaluateCandidate(current,c).publishable,false);
});
