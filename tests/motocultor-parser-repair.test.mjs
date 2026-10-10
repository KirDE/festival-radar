import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {discoverMotocultorAnnouncement} from '../lib/ingestion/adapters/motocultor.ts';
import {validateSource} from '../lib/sources/repository.ts';
import {parserSource} from './support/parser-source.ts';
const source = parserSource('motocultor', {url:'https://www.motocultor-festival.com/actualites/'});
const at='2026-10-10T09:41:03.674Z';
const html=await readFile(new URL('./fixtures/official-markup/motocultor-announcement.html',import.meta.url),'utf8');
const news=await readFile(new URL('./fixtures/official-markup/motocultor-news.html',import.meta.url),'utf8');
const expected=['Helloween','Halestorm','The HU','Wind Rose','Kanonenfieber','Malevolence','Slomosa','Dark Funeral','Equilibrium','John Bush','Make Them Suffer','My Sleeping Karma','Non Est Deus','PeelingFlesh','Prong','Sylosis','Shadow of Intent','The Acacia Strain','The Browning'];
const current={slug:'motocultor',editionYear:2027,startDate:'2027-08-19',endDate:'2027-08-22',city:'Carhaix',status:'partial',ticketStatus:'unknown',headliners:[expected[0]],lineup:expected.slice(1)};
const parse=h=>extractFestivalCandidate(h,source,at);
const sorted=x=>x.map(n=>n.toLocaleLowerCase()).sort();
test('real corrected Motocultor announcement covers all 19 members without inventing poster ranking, dates or stock',()=>{
  assert.equal(validateSource(source),'official_markup:motocultor');
  const c=parse(html);assert.deepEqual(sorted(c.lineup),sorted(expected));assert.equal(c.lineupScope,'announcement');assert.equal(c.status,'partial');assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[2027]);
  for(const field of ['headliners','startDate','endDate','city','ticketStatus','ticketsUrl']) assert.equal(c[field],undefined);
  assert.deepEqual(evaluateCandidate(current,c).changes,[]);assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);
  assert.ok(!c.lineup.some(n=>/anthrax|early bird/i.test(n)));
});
test('later official text changes and new named acts are not hash- or bill-locked',()=>{
  const next=html.replace('THE BROWNING</b>','THE BROWNING · GOJIRA · MASTODON</b>').replace('1993–2003','a special anniversary set');
  const c=parse(next);assert.equal(c.lineup.length,21);assert.deepEqual(c.warnings,[]);
  const r=evaluateCandidate({...current,lineup:[...current.lineup,'Later Verified Act']},c);
  assert.deepEqual(r.changes.map(x=>[x.kind,x.after]),[['artist_added','GOJIRA'],['artist_added','MASTODON']]);assert.deepEqual(r.reviewReasons,[]);
});
test('later small news drops preserve verified partial bill and complete status',()=>{
  const next=html.replace(/<p><b>HELLOWEEN[\s\S]*?THE BROWNING<\/b><\/p>/,'<p><strong>GOJIRA · MASTODON</strong></p>').replace('premiers noms','nouveaux groupes');
  const c=parse(next);assert.deepEqual(c.lineup,['GOJIRA','MASTODON']);
  const r=evaluateCandidate({...current,status:'confirmed'},c);assert.equal(r.changes.length,2);assert.ok(r.changes.every(x=>x.kind==='artist_added'));assert.deepEqual(r.reviewReasons,[]);
});
test('wrong editions, cancellation prose, unknown layout and duplicate names fail closed',()=>{
  for(const h of [html.replaceAll('2027','2026'),html.replace('Et ce n′est que le début.','JOHN BUSH ne jouera pas.'),html.replace('premiers noms','billets'),html.replace('THE BROWNING</b>','THE BROWNING · THE HU</b>'),html.replace('THE BROWNING</b>','THE BROWNING annulé</b>'),html.replace('THE BROWNING</b>','THE BROWNING</b> new unread names')]) {
    const c=parse(h);assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);
  }
});
test('latest same-host news discovery excludes tour, archive and navigation, accepts changed future slugs',()=>{
  const url='https://www.motocultor-festival.com/les-premiers-noms-de-ledition-2027-sont-la/';
  assert.equal(discoverMotocultorAnnouncement(news,source),url);
  const card='<h3 class="blog-post_title"><a href="/20-nouveaux-groupes/">20 nouveaux groupes</a></h3>';
  assert.equal(discoverMotocultorAnnouncement(card+news,source),'https://www.motocultor-festival.com/20-nouveaux-groupes/');
  assert.equal(discoverMotocultorAnnouncement(card.replace('/20-nouveaux-groupes/','https://evil.example/20-nouveaux-groupes/')+news,source),url);
  assert.equal(discoverMotocultorAnnouncement(card.replace('20 nouveaux groupes','Groupes annulés 2027')+news,source),undefined);
});
test('actual discovery fetches official article; 403 stays a source failure',async()=>{
  const seen=[];const result=await fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{seen.push(url);return new Response(seen.length===1?news:html,{status:200});}});
  assert.equal(seen.length,2);assert.match(seen[1],/les-premiers-noms-de-ledition-2027/);assert.equal(parse(await result.response.text()).lineup.length,19);
  const denied=await fetchSource(source,{maxAttempts:1,fetchImpl:async()=>new Response('blocked',{status:403})});assert.equal(denied.response.status,403);assert.equal(denied.attempts,1);
  await assert.rejects(()=>fetchSource(source,{maxAttempts:1,fetchImpl:async()=>new Response('<h3>No bill</h3>')}),/No current-edition/);
});
