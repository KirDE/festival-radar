import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
const fixture = name => readFileSync(new URL(`./fixtures/idays/${name}-2027.html`,import.meta.url),'utf8');
const home=fixture('home'), lineup=fixture('lineup'), tickets=fixture('tickets');
const source={festivalSlug:'idays',url:'https://www.idays.it/',strategies:['json_ld_event','html_fallback'],editionYear:2027,enabled:true,refreshPolicy:'daily'};
const parse=(html=home, overrides={})=>extractFestivalCandidate(html,{...source,...overrides},'2026-10-10T17:10:00Z');
const current={slug:'idays',editionYear:2027,headliners:['blink-182','Fontaines D.C.','SOMBR','Bresh'],lineup:['Pierce the Veil'],status:'partial',ticketStatus:'available',ticketsUrl:'https://www.idays.it/tickets'};
test('real corrected homepage: all headline/support roles, partial, no artificial date span, quiet persisted case',()=>{
 const c=parse();assert.deepEqual(c.headliners,['Blink-182','Fontaines D.C.','Sombr','Bresh']);assert.deepEqual(c.lineup,['Pierce The Veil']);assert.deepEqual(c.observedEditionYears,[2027]);assert.equal(c.status,'partial');assert.equal(c.artistListMode,'additive');assert.equal(c.ticketsUrl,current.ticketsUrl);
 for(const field of ['startDate','endDate','city','ticketStatus'])assert.equal(c[field],undefined);
 const r=evaluateCandidate(current,c);assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);assert.equal(r.publishable,false);
});
test('actual line-up image headings give explicit headliner vs special-guest billing without biography contamination',()=>{
 const c=parse(lineup,{url:'https://www.idays.it/line-up'});assert.deepEqual(c.headliners,['BLINK-182','FONTAINES D.C.','SOMBR','BRESH']);assert.deepEqual(c.lineup,['PIERCE THE VEIL']);assert.deepEqual(evaluateCandidate(current,c).reviewReasons,[]);assert.deepEqual(evaluateCandidate(current,c).changes,[]);
});
test('current general-admission sales, not disability-area exhaustion, prove available; no off-host URL published',()=>{
 const c=parse(tickets,{url:'https://www.idays.it/tickets'});assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,current.ticketsUrl);assert.equal(c.status,undefined);assert.equal(c.lineup,undefined);assert.deepEqual(c.warnings,[]);
});
test('future artist changes and new identities retain review/provider gate, not a frozen bill',()=>{
 const c=parse(home.replaceAll('Sombr','New Artist').replace('Pierce The Veil, and more...','Pierce The Veil, Future Support, and more...'));
 assert.ok(c.headliners.includes('New Artist'));assert.ok(c.lineup.includes('Future Support'));
 const r=evaluateCandidate(current,c);assert.ok(r.reviewReasons.length);assert.equal(r.publishable,false);assert.ok(r.changes.some(x=>x.after==='New Artist'));assert.ok(r.changes.some(x=>x.after==='Future Support'));assert.ok(!r.changes.some(x=>x.kind.endsWith('_removed')));
});
test('partial extraction preserves extra verified artists and cannot downgrade full bill',()=>{
 const r=evaluateCandidate({...current,status:'confirmed',headliners:[...current.headliners,'Later Headliner'],lineup:[...current.lineup,'Later Support']},parse());assert.deepEqual(r.changes,[]);assert.deepEqual(r.reviewReasons,[]);
});
test('edition/host/route/card/link drift and image-only announcements require review, not quiet success',()=>{
 for(const html of [home.replaceAll('2027','2026'),home.replace('protagonisti','artisti'),home.replaceAll('MuiTypography-header3','other-heading'),home.replace('/tickets#13-giugno','https://evil.test/tickets#13-giugno'),'<h2>2027</h2><img src="new-lineup.png">','Access denied'])assert.ok(evaluateCandidate(current,parse(html)).reviewReasons.length);
 for(const overrides of [{url:'https://evil.test/'},{url:'https://www.idays.it/archive'},{url:'https://www.idays.it/?year=2027'}])assert.ok(parse(home,overrides).warnings.length);
});
test('later edition, benign HTML edits and script/nav pollution are supported without document hashes',()=>{
 const c=parse(home.replaceAll('2027','2028')+'<nav class="artist">Archive Band 2026</nav><script>Scopri i protagonisti dell\'edizione 2026</script>',{editionYear:2028});assert.deepEqual(c.observedEditionYears,[2028]);assert.equal(c.headliners.length,4);assert.equal(c.lineup.length,1);assert.equal(c.startDate,undefined);
});
test('expired/disabled/merch/untrusted purchases and CTA-only pages cannot invent available',()=>{
 for(const html of [tickets.replaceAll('2027','2026'),tickets.replaceAll('>Acquista',' aria-disabled="true">Acquista'),tickets.replaceAll('www.ticketmaster.it','evil.test').replaceAll('www.vivaticket.com','evil.test'),tickets.replaceAll('/biglietti/','/merch/').replaceAll('/it/ticket/','/merch/'),home])assert.equal(parse(html,{url:'https://www.idays.it/tickets'}).ticketStatus,undefined);
});
test('semantic warnings survive the unchanged-case gate and cancellations do not become automatic additions',()=>{
 assert.ok(evaluateCandidate(current,{...parse(),warnings:['Cancellation needs review']}).reviewReasons.length);
 assert.ok(parse(home.replace('Pierce The Veil, and more...','Pierce The Veil cancelled, and more...')).warnings.some(x=>x.includes('cancellation')));
});
