import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { diffFestival } from '../lib/ingestion/diff.ts';
import { fetchSource } from '../lib/ingestion/fetch.ts';
import { frequencyDocuments } from '../lib/ingestion/adapters/frequency.ts';
const root = 'https://www.frequency.at/';
const source = { festivalSlug: 'frequency', url: root, editionYear: 2027, strategies: ['json_ld_event','html_fallback'], refreshPolicy: 'daily', enabled: true };
const observedAt = '2026-10-10T13:49:00.000Z';
const fixture = (name) => readFile(new URL(`./fixtures/official-markup/frequency-${name}-20261010.html`, import.meta.url), 'utf8');
const parse = (input, config=source) => extractFestivalCandidate(input, config, observedAt);

test('real corrected Frequency homepage and standard Offer reproduce all four corrected fields', async () => {
  const result = parse(frequencyDocuments(await fixture('home'), await fixture('tickets')));
  assert.equal(result.startDate,'2027-08-19'); assert.equal(result.endDate,'2027-08-21');
  assert.equal(result.ticketsUrl,root+'tickets/'); assert.equal(result.ticketStatus,'available');
  assert.deepEqual(result.observedEditionYears,[2027]); assert.deepEqual(result.warnings,[]);
  for (const field of ['lineup','headliners','status']) assert.equal(result[field],undefined);
  assert.equal(result.evidence.find(x=>x.field==='ticketStatus').sourceUrl,root+'tickets/');
});
test('homepage ticket CTA is not live availability; previous-year lineup cannot import artists', async () => {
  assert.equal(parse(await fixture('home')).ticketStatus,undefined);
  const old = parse(await fixture('lineup'));
  for (const field of ['lineup','headliners','status','startDate','ticketStatus']) assert.equal(old[field],undefined);
  assert.ok(old.warnings.length);
});
test('later official dates and festival-pass announcement work without a fixed edition, bill or document hash', async () => {
  const result=parse(frequencyDocuments((await fixture('home')).replaceAll('2027','2028').replace('19.-21. August','17.–19. Juli'),(await fixture('tickets')).replaceAll('2027','2028')), {...source,editionYear:2028});
  assert.equal(result.startDate,'2028-07-17'); assert.equal(result.endDate,'2028-07-19'); assert.equal(result.ticketStatus,'available');
  assert.deepEqual(result.observedEditionYears,[2028]); assert.deepEqual(result.warnings,[]);
});
test('old edition and invalid date cannot produce current dates', async () => {
  const home=await fixture('home');
  for (const input of [home.replaceAll('2027','2026'),home.replace('19.-21. August','29.-31. Februar'), home.replace('19.-21.','22.-19.')]) {
    const result=parse(input); assert.equal(result.startDate,undefined); assert.equal(result.endDate,undefined); assert.ok(result.warnings.length);
  }
});
test('VIP, lodging and parking offers do not establish festival availability or global sold-out status', async () => {
  const tickets=await fixture('tickets');
  const withoutStandard=tickets.replace(/<li\b[^>]*class="ticket__excerpt ticket-2027-festivalpass"[^>]*>[\s\S]*?<\/section>\s*<\/li>/,'');
  assert.equal(parse(frequencyDocuments(await fixture('home'),withoutStandard)).ticketStatus,undefined);
  const sold=tickets.replace('<h3 class="ticket__extratext">Jetzt verfügbar</h3>','<h3 class="ticket__extratext">Ausverkauft</h3>');
  const result=parse(frequencyDocuments(await fixture('home'),sold)); assert.equal(result.ticketStatus,undefined); assert.ok(result.warnings.length);
});
test('standard Offer needs its own live stock label, price and trusted year-bound purchase link', async () => {
  const tickets=await fixture('tickets'), home=await fixture('home');
  for (const changed of [tickets.replaceAll('https://www.oeticket.com/','https://lookalike.invalid/'),tickets.replaceAll('2027-4212181','2026-4212181'),tickets.replace('itemprop="price" content="€ 239,99"','itemprop="price" content=""')]) {
    assert.equal(parse(frequencyDocuments(home,changed)).ticketStatus,undefined);
  }
});
test('fetch follows only the official linked tickets page and parses both real documents', async () => {
  const calls=[]; const home=await fixture('home'), tickets=await fixture('tickets');
  const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=> { calls.push(url); return new Response(url===root?home:tickets); }});
  assert.deepEqual(calls,[root,root+'tickets/']); assert.equal(fetched.attempts,2);
  const result=parse(await fetched.response.text()); assert.equal(result.ticketStatus,'available'); assert.equal(result.startDate,'2027-08-19');
});
test('missing trusted ticket link is not replaced by an unlinked or external fetch', async () => {
  const calls=[];
  const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=> { calls.push(url); return new Response((await fixture('home')).replaceAll(root+'tickets/','https://untrusted.invalid/tickets/')); }});
  assert.deepEqual(calls,[root]); assert.equal(parse(await fetched.response.text()).ticketStatus,undefined);
});
test('ticket fetch failure remains a source failure instead of pretending the CTA confirmed stock', async () => {
  const fetched=await fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=>new Response(url===root?await fixture('home'):'Forbidden',{status:url===root?200:403})});
  assert.equal(fetched.response.status,403); assert.equal(fetched.attempts,2);
});
test('official document redirect cannot substitute an external ticket page', async () => {
  await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async(url)=> {
    const res=new Response(url===root?await fixture('home'):await fixture('tickets'));
    Object.defineProperty(res,'url',{value:url===root?root:'https://untrusted.invalid/tickets/'});return res;
  }}),/redirected away/);
});

test('corrected catalog and verified later partial lineup remain unchanged with no provider-triggering additions', async () => {
  const result=parse(frequencyDocuments(await fixture('home'),await fixture('tickets')));
  const current={id:'frequency',slug:'frequency',editionYear:2027,year:2027,name:'Frequency',startDate:'2027-08-19',endDate:'2027-08-21',ticketsUrl:root+'tickets/',ticketStatus:'available',status:'partial',lineup:['Verified Support'],headliners:['Verified Headliner']};
  assert.deepEqual(diffFestival(current,result),[]);
  assert.deepEqual(evaluateCandidate(current,result).reviewReasons,[]);
  assert.equal(evaluateCandidate(current,result).publishable,false);
});
