import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fetchSource } from '../lib/ingestion/fetch.ts';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const dir = new URL('./fixtures/brutal-assault/', import.meta.url);
const docs = Object.fromEntries(await Promise.all(['home','lineup','tickets','pass'].map(async k => [k, await readFile(new URL(k+'.html', dir),'utf8')])));
const facts = JSON.parse(await readFile(new URL('expected.json',dir),'utf8'));
const source = { festivalSlug:'brutal-assault',url:'https://brutalassault.cz/',strategies:['json_ld_event','html_fallback'],editionYear:2027,enabled:true,refreshPolicy:'weekly' };
const at='2026-10-10T15:07:00.000Z';
async function parse(overrides={},sourceOverride={}) {
  const d={...docs,...overrides},s={...source,...sourceOverride},requests=[];
  const pages={'https://brutalassault.cz/':d.home,'https://brutalassault.cz/en/line-up':d.lineup,'https://brutalassault.cz/en/tickets':d.tickets};
  const fetched=await fetchSource(s,{maxAttempts:1,fetchImpl:async url=>{requests.push(String(url));assert.equal(new URL(url).origin,'https://brutalassault.cz');return new Response(pages[url]??d.pass);}});
  const payload=await fetched.response.text();
  return {candidate:extractFestivalCandidate(payload,s,at),payload,requests,attempts:fetched.attempts};
}
test('real correction: 63 unranked linked acts, both long guest acts, live dates and cart, partial rather than full bill',async()=>{
  const {candidate:c,requests,attempts}=await parse();
  for(const key of ['lineup','startDate','endDate','status','ticketStatus','ticketsUrl'])assert.deepEqual(c[key],facts[key],key);
  assert.equal(c.headliners,undefined);assert.deepEqual(c.warnings,[]);assert.deepEqual(c.observedEditionYears,[2027]);assert.equal(attempts,4);
  assert.deepEqual(requests,['https://brutalassault.cz/','https://brutalassault.cz/en/line-up','https://brutalassault.cz/en/tickets','https://brutalassault.cz/en/tickets/detail/id/1209']);
  assert.equal(c.evidence.find(e=>e.field==='lineup').sourceUrl,'https://brutalassault.cz/en/line-up');
  assert.equal(c.evidence.find(e=>e.field==='startDate').sourceUrl,requests[3]);
  const result=evaluateCandidate({slug:source.festivalSlug,editionYear:2027,city:'Jaroměř',...facts,headliners:[]},c);
  assert.deepEqual(result.changes,[]);assert.deepEqual(result.reviewReasons,[]);
});
test('commented homepage is never interpreted as a current empty or complete bill',()=>{
  const c=extractFestivalCandidate(docs.home,source,at);assert.equal(c.lineup,undefined);assert.equal(c.status,undefined);assert.match(c.warnings.join(' '),/fresh linked/);
});
test('future artist cards and changed percentage work without hardcoded bill or content hash',async()=>{
  const lineup=docs.lineup.replace('47%','52%')+'<a href="/en/band/new-act" class="lineup_band_link"><strong class="band_lineup_title">NEW ACT</strong></a>';
  const {candidate:c}=await parse({lineup});assert.equal(c.lineup.length,64);assert.ok(c.lineup.includes('NEW ACT'));assert.equal(c.status,'partial');assert.deepEqual(c.warnings,[]);
});
test('current pass is rediscovered when the ticket ID changes, stale and voucher products excluded',async()=>{
  const tickets=docs.tickets.replaceAll('/1209','/9999')+'<a class="product_title" href="/en/tickets/detail/id/2026">BRUTAL ASSAULT 2026 festival pass</a>';
  const pass=docs.pass.replaceAll('/1209','/9999');const r=await parse({tickets,pass});assert.equal(r.requests[3],'https://brutalassault.cz/en/tickets/detail/id/9999');assert.equal(r.candidate.ticketStatus,'available');
});
test('later edition date range supported, not read from stale generic info or price deadline',async()=>{
  const {candidate:c}=await parse({tickets:docs.tickets.replaceAll('2027','2028'),pass:docs.pass.replaceAll('2027','2028').replace('Aug 04-07','Aug 02-05')},{editionYear:2028});
  assert.equal(c.startDate,'2028-08-02');assert.equal(c.endDate,'2028-08-05');assert.deepEqual(c.observedEditionYears,[2028]);
});
test('wrong-edition product cannot establish dates, availability or lineup',async()=>{
  const {candidate:c}=await parse({pass:docs.pass.replaceAll('2027','2026')});assert.equal(c.lineup,undefined);assert.equal(c.startDate,undefined);assert.equal(c.ticketStatus,undefined);assert.deepEqual(c.observedEditionYears,[2026]);assert.match(c.warnings.join(' '),/current general/);
});
test('disabled purchase is not availability; explicit sold out remains an operational fact',async()=>{
  const pass=docs.pass.replace('type="submit"','disabled type="submit"');const r=await parse({pass});assert.equal(r.candidate.ticketStatus,undefined);
  const sold=await parse({pass:pass.replace('<span>Available</span>','<span>Sold out</span>')});assert.equal(sold.candidate.ticketStatus,'unavailable');
});
test('empty or shortened live cards never silently overwrite verified partial lineup',async()=>{
  const empty=await parse({lineup:'<h1>47% CONFIRMED!</h1>'});assert.equal(empty.candidate.lineup,undefined);assert.match(empty.candidate.warnings.join(' '),/do not erase/);
  const short=await parse({lineup:docs.lineup.replace(/<a[^>]*>[\s\S]*?<\/a>/,'')});const r=evaluateCandidate({slug:source.festivalSlug,editionYear:2027,...facts},short.candidate);assert.equal(r.publishable,false);assert.ok(r.reviewReasons.includes('Removals require confirmation'));
});
test('unknown completeness and impossible dates fail closed',async()=>{
  const unknown=await parse({lineup:docs.lineup.replace('47% CONFIRMED!','Line-up')});assert.equal(unknown.candidate.lineup,undefined);assert.ok(unknown.candidate.warnings.length);
  const invalid=await parse({pass:docs.pass.replace('Aug 04-07','Feb 30-31')});assert.equal(invalid.candidate.lineup,undefined);assert.equal(invalid.candidate.startDate,undefined);assert.match(invalid.candidate.warnings.join(' '),/Invalid/);
});
test('external, absent and ambiguous product links are rejected without external requests',async()=>{
  for(const tickets of [docs.tickets.replaceAll('https://brutalassault.cz/en/tickets/detail/id/1209','https://evil.example/en/tickets/detail/id/1209'),'',docs.tickets+'<a class="product_title" href="/en/tickets/detail/id/999">BRUTAL ASSAULT 2027 festival pass</a>'])await assert.rejects(parse({tickets}),/absent or ambiguous/);
});
test('inaccessible official subdocument remains HTTP failure, never a successful archive parse',async()=>{
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async url=>new Response(url===source.url?docs.home:'Blocked',{status:url===source.url?200:403})}),e=>e.httpStatus===403 && /HTTP 403/.test(e.message));
});
test('adapter is scoped to registered source configuration and does not hijack other festivals',async()=>{
  const c=extractFestivalCandidate('<span data-artist="Band A"></span>',{...source,festivalSlug:'other'},at);assert.deepEqual(c.lineup,['Band A']);
  const {payload}=await parse();const changed=extractFestivalCandidate(payload,{...source,url:'https://untrusted.example/'},at);assert.equal(changed.lineup,undefined);
});
test('complete bill is explicit percentage, never inferred from announcement size or guest labels',async()=>{
  const {candidate:c}=await parse({lineup:docs.lineup.replace('47%','100%')});assert.equal(c.status,'confirmed');assert.equal(c.headliners,undefined);assert.equal(c.lineup.length,63);
});
test('malformed bundles and off-site subdocument redirects cannot supply trusted facts',async()=>{
  for(const raw of ['null','{}','[]']){const c=extractFestivalCandidate(raw,source,at);assert.equal(c.lineup,undefined);assert.match(c.warnings.join(' '),/Invalid/);}
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async url=>{
    const r=new Response(url===source.url?docs.home:docs.lineup);if(url!==source.url)Object.defineProperty(r,'url',{value:'https://evil.example/en/line-up'});return r;
  }}),/Unexpected.*redirect/);
});
test('explicit archived lineup edition is not relabelled by a current pass or footer year',async()=>{
  const {candidate:c}=await parse({lineup:'<h2>Brutal Assault 2026 Line-up</h2>'+docs.lineup});assert.equal(c.lineup,undefined);assert.deepEqual(c.observedEditionYears,[2026]);assert.match(c.warnings.join(' '),/different edition/);
  const current=await parse({lineup:docs.lineup+'<footer>© 1996 - 2026</footer>'});assert.equal(current.candidate.lineup.length,63);assert.deepEqual(current.candidate.warnings,[]);
});
