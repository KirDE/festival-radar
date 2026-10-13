import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {fetchSource} from '../lib/ingestion/fetch.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {discoverDynamoTickets,extractDynamoTickets} from '../lib/ingestion/adapters/dynamo-tickets.ts';
import {discoverDynamoBands} from '../lib/ingestion/adapters/dynamo.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {parserSource} from './support/parser-source.ts';
const root='https://dynamo-metalfest.nl',url=root+'/first-names-dmf-27/',ticketUrl=root+'/early-bird-tickets-are-live/';
const fixture=await readFile(new URL('./fixtures/official-markup/dynamo-first-names-2027.html',import.meta.url),'utf8');
const article=await readFile(new URL('./fixtures/official-markup/dynamo-early-bird-2027.html',import.meta.url),'utf8');
const captured=JSON.parse(await readFile(new URL('./fixtures/official-markup/dynamo-live-sale-2027.json',import.meta.url),'utf8'));
const docs=JSON.parse(await readFile(new URL('./fixtures/official-markup/dynamo-current-discovery-2027.json',import.meta.url),'utf8'));
const at=captured.storefront.generated_on,source=parserSource('dynamo-metal-fest',{url});
const current={slug:'dynamo-metal-fest',editionYear:2027,city:'Eindhoven',startDate:'2027-08-13',endDate:'2027-08-15',status:'partial',headliners:[],lineup:docs.map(d=>d.heading.replace(/Cavalera – Choas A.D./,'Cavalera').replace('Corrosion Of Conformity','Corrosion of Conformity').replace('Left To Suffer','Left to Suffer')),ticketStatus:'available',ticketsUrl:ticketUrl};
function mock(change){
  const data=structuredClone(captured);data.sale.jwt_token='anonymous-test-only';change?.(data);
  const calls=[];const fetchImpl=async (u,o)=>{
    calls.push({url:u,auth:o?.headers?.authorization,redirect:o?.redirect});
    if(u===url)return new Response(fixture+`<a href="${root}/line-up/">Line-up</a>`);
    if(u===root+'/line-up/')return new Response(`<link rel="canonical" href="${u}"><main><h1>LINE-UP</h1>${docs.map(d=>`<a href="${d.url}"><div data-widget_type="theme-post-title.default"><h2>${d.heading}</h2></div></a>`).join('')}</main>`);
    const band=docs.find(d=>d.url===u);if(band)return new Response(`<title>${band.title.replace('&','&amp;')}</title><link rel="canonical" href="${u}"><div data-elementor-type="single-post"><h1>${band.heading} op Dynamo Metalfest in Eindhoven Nederland</h1><h2>${band.heading}</h2><a href="${root}/line-up/">TERUG NAAR LINE-UP 2027</a></div><footer></footer><script class="dmf-schema">${JSON.stringify(band.event)}</script>`);
    if(u===root+'/nieuws/')return new Response(`<h1>NIEUWS</h1><a href="${ticketUrl}">Early Bird Tickets Are Live!</a><a href="https://evil.example/tickets/">Tickets</a>`);
    if(u===ticketUrl)return new Response(data.article??article);
    if(u===data.sale._links.self.href)return new Response(JSON.stringify(data.sale));
    if(u.startsWith('https://shopping-api.paylogic.com/storefront?'))return new Response(JSON.stringify(data.storefront));
    assert.fail('Unexpected URL '+u);
  };return {data,calls,fetchImpl};
}
async function candidate(m){const fetched=await fetchSource(source,{fetchImpl:m.fetchImpl,maxAttempts:1});return extractFestivalCandidate(await fetched.response.text(),source,at);}
const ticketFacts=c=>[c.ticketStatus,c.ticketsUrl];
test('real SEO heading drift + live early bird correction: complete preserved partial bill, zero diff/review',async()=>{
  const m=mock(),c=await candidate(m);assert.deepEqual(c.lineup,current.lineup);assert.equal(c.status,'partial');assert.equal(c.headliners,undefined);assert.deepEqual(ticketFacts(c),['available',ticketUrl]);assert.deepEqual(c.warnings,[]);const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(c.evidence.find(e=>e.field==='ticketStatus').sourceUrl,ticketUrl);
  assert.equal(m.calls.length,17);assert.equal(m.calls.filter(c=>c.auth).length,1);const authorized=m.calls.find(c=>c.auth);assert.ok(authorized.url.startsWith('https://shopping-api.paylogic.com/storefront?'));assert.equal(authorized.redirect,'error');
});
test('article alone, loyalty soldout and future tiers do not assert live inventory or low availability',()=>{
  assert.deepEqual(extractDynamoTickets(article,'2027-08-13','2027-08-15',at),{});
});
test('later official sale ID and regular tier, not frozen hash or early-bird list, remain supported',async()=>{
  const m=mock(d=>{const old=d.sale.uid,next='12345678901234567890123456789012';d.sale.uid=next;d.sale._links.self.href=d.sale._links.self.href.replace(old,next);d.storefront._embedded['shop:event']._links['shop:ticketshop'].href=d.storefront._embedded['shop:event']._links['shop:ticketshop'].href.replace(old,next);d.article=article.replaceAll(old,next);for(const p of d.storefront._embedded['shop:product']){const item=d.storefront.categories[0].categories[0].items.find(i=>i.product===p._links.self.href);item.is_sold_out=p.name.en!=='REGULAR WEEKEND TICKET';}});
  assert.deepEqual(ticketFacts(await candidate(m)),['available',ticketUrl]);
});
test('wrong edition/date/city/event/shop, stale shop, unpublished sale, closed/restricted/merch tiers preserve ticket facts',async()=>{
  const mutations=[d=>d.article=article.replaceAll('2027','2026'),d=>d.article=article.replace('13, 14 &amp; 15','20, 21 &amp; 22'),d=>d.storefront._embedded['shop:event'].title.en='Dynamo Metalfest 2026',d=>d.storefront._embedded['shop:event'].location.city='Other City',d=>d.storefront._embedded['shop:event']._links.self.href+='wrong',d=>d.storefront._embedded['shop:event']._links['shop:ticketshop'].href+='wrong',d=>d.storefront.generated_on='2026-08-13T20:27:13Z',d=>d.sale.state='Draft',d=>d.sale.end_date='2026-09-01T00:00:00Z',d=>d.storefront.is_sold_out=true,d=>d.storefront._embedded['shop:product'].forEach(p=>p.type='merchandise'),d=>d.storefront._embedded['shop:product'].forEach(p=>p.requires_membership=true),d=>d.storefront.categories[0].categories[0].items.forEach(i=>i.max_quantity=0),d=>d.storefront.categories[0].categories[0].items.forEach(i=>i.is_sold_out=true)];
  for(const mutate of mutations){const c=await candidate(mock(mutate));assert.deepEqual(ticketFacts(c),[undefined,undefined]);assert.deepEqual(c.lineup,current.lineup);assert.equal(c.status,'partial');}
});
test('403, missing canonical, redirect and malformed live data do not turn into successful inventory',async()=>{
  for(const target of [ticketUrl,captured.sale._links.self.href,'storefront']){const m=mock();await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:(u,o)=>u===target||(target==='storefront'&&u.includes('/storefront?'))?Promise.resolve(new Response('blocked',{status:403})):m.fetchImpl(u,o)}),/HTTP 403/);}
  assert.deepEqual(ticketFacts(await candidate(mock(d=>d.article=article.replace('rel="canonical"','rel="alternate"')))),[undefined,undefined]);
  const redirected=mock();await assert.rejects(discoverDynamoTickets(fixture,async(u,o)=>{const r=await redirected.fetchImpl(u,{headers:o});if(u===ticketUrl)Object.defineProperty(r,'url',{value:'https://evil.example/'});return r;}),/redirected/);
  const m=mock();await assert.rejects(discoverDynamoTickets(fixture,(u,o)=>u.includes('/storefront?')?Promise.resolve(new Response('not JSON')):m.fetchImpl(u,{headers:o})),SyntaxError);
  const wrong=mock(d=>d.sale._links.self.href='https://evil.example/sales/x');await assert.rejects(candidate(wrong));
});
test('SEO heading support does not trust unrelated artist identity or title',async()=>{
  const m=mock();const body=await discoverDynamoBands(fixture+`<a href="${root}/line-up/">Line-Up</a>`,u=>m.fetchImpl(u));assert.equal(extractFestivalCandidate(body,source,at).lineup.length,11);
  const bad=mock();const html=await discoverDynamoBands(fixture+`<a href="${root}/line-up/">Line-Up</a>`,async u=>{const r=await bad.fetchImpl(u);return u.endsWith('/fulci/')?new Response((await r.text()).replace('<h1>Fulci op','<h1>Other Artist op')):r;});assert.equal(extractFestivalCandidate(html,source,at).lineup,undefined);
});
test('serialized ingestion envelope never contains shop JWT, price or tracker fields',async()=>{
 const m=mock();const fetched=await fetchSource(source,{fetchImpl:m.fetchImpl,maxAttempts:1});const body=await fetched.response.text();assert.ok(!body.includes('anonymous-test-only'));assert.ok(!body.includes('jwt_token'));assert.ok(!body.includes('tracking_tags'));assert.ok(!body.includes('price_breakdown'));
});
