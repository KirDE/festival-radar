import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {extractInfernoCandidate} from '../lib/ingestion/adapters/inferno.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {fetchSource} from '../lib/ingestion/fetch.ts';
const fixture=readFileSync(new URL('./fixtures/inferno-home-2027.html',import.meta.url),'utf8');
const source={festivalSlug:'inferno',url:'https://www.infernofestival.net/',editionYear:2027,strategies:['json_ld_event','html_fallback'],enabled:true,refreshPolicy:'every_3_days'};
const at='2026-10-11T00:18:00Z';
const expected=['Arcturus','Asagraum','Bianca','Blasphemy','Blodmaane','Daeva','Deadnate','Ellende','Green Carnation','Heimland','Hellripper','Houle','Jordsjuk','Kampfar','Kraanium','Krapyl','KVAEN','Lifesick','MASTER’S HAMMER','Melting Brain Club','Mgła','Oskaal','Ruïm','Sarkom','Shores of Null','Split','Stigma Diabolicum','The Ruins of Beverast','Towards the Sinister','Trelldom'];
const current={slug:'inferno',editionYear:2027,startDate:'2027-03-25',endDate:'2027-03-28',status:'partial',ticketsUrl:source.url+'tickets',ticketStatus:'available',headliners:[],lineup:expected};
const parse=(html=fixture,s=source)=>extractFestivalCandidate(html,s,at);
const changes=(candidate,festival=current)=>evaluateCandidate(festival,candidate);

test('real correction: 30 artists, partial status, festival-only dates and live normal pass reproduce verified facts',()=>{
 const c=parse();assert.deepEqual(c.lineup.map(n=>n.toLowerCase()).sort(),expected.map(n=>n.toLowerCase()).sort());assert.equal(c.startDate,current.startDate);assert.equal(c.endDate,current.endDate);assert.equal(c.ticketStatus,'available');assert.equal(c.ticketsUrl,current.ticketsUrl);assert.equal(c.status,'partial');assert.equal(c.headliners,undefined);assert.equal(c.lineupScope,'announcement');assert.deepEqual(c.observedEditionYears,[2027]);assert.deepEqual(c.warnings,[]);assert.deepEqual(changes(c).changes,[]);assert.deepEqual(changes(c).reviewReasons,[]);assert.ok(c.evidence.find(e=>e.field==='startDate').excerpt.includes('4 Day Festival Pass'));
});

test('later live year, month, date, price and new artist are parsed without a hardcoded bill or hash',()=>{
 const html=fixture.replaceAll('2027','2028').replaceAll('March 25-28th','April 13-16th').replaceAll('3995','4295').replace('>Kampfar</a>','>Kampfar</a><a href="/artists/new-act">New Act</a>');const c=parse(html,{...source,editionYear:2028});assert.equal(c.startDate,'2028-04-13');assert.equal(c.endDate,'2028-04-16');assert.ok(c.lineup.includes('New Act'));assert.equal(c.ticketStatus,'available');
});

test('additive announcement never removes verified partial artists or rewrites reviewed headliner billing',()=>{
 const c=parse(fixture.replace('>Kampfar</a>','>New Act</a>'));const r=changes(c,{...current,status:'confirmed',headliners:['Mgła'],lineup:current.lineup.filter(n=>n!=='Mgła').concat('Previously Reviewed Act')});assert.deepEqual(r.changes.map(c=>[c.kind,c.after]),[['artist_added','New Act']]);assert.deepEqual(r.reviewReasons,[]);
});

test('artist links in archived news, scripts, comments or hidden nodes are not current bill',()=>{
 const garbage='<a href="/artists/old">Old Artist</a>';const c=parse(fixture+'<section>'+garbage+'</section><script>'+garbage+'</script><!--'+garbage+'--><div hidden>'+garbage+'</div>');assert.equal(c.lineup.length,30);assert.ok(!c.lineup.includes('Old Artist'));
});

test('non-musical links and untrusted profile origins are not artists',()=>{
 const html=fixture.replace('>Kampfar</a>','>Kampfar</a><a href="https://evil.example/artists/fake">Fake</a><a href="/articles/artwork">Artwork</a><a href="/artists/archive?year=2026">Archived</a>');assert.equal(parse(html).lineup.length,30);
});

test('wrong visible edition carries a review reason without supplying stale fields',()=>{
 const c=parse(fixture.replaceAll('2027','2026'));assert.deepEqual(c.observedEditionYears,[2026]);for(const field of ['lineup','startDate','endDate','ticketStatus','ticketsUrl'])assert.equal(c[field],undefined);assert.ok(changes(c).reviewReasons.some(r=>r.includes('edition')));
});

test('conference/hotel products do not supply festival dates or availability',()=>{
 const html=fixture.replace(/<a data-ticket-card=""[^>]*data-track-label="2027 - 4 Day Festival Pass"[\s\S]*?<\/a>/,'');const c=parse(html);assert.equal(c.startDate,undefined);assert.equal(c.ticketStatus,undefined);assert.equal(c.lineup.length,30);
});

test('missing/disabled/untrusted/hidden purchase controls and stale prices do not mean tickets are available',()=>{
 for(const html of [fixture.replaceAll('Buy','Coming soon'),fixture.replaceAll('data-ticket-card=""','data-ticket-card="" aria-disabled="true"'),fixture.replaceAll('www.ticketmaster.no','evil.example'),fixture.replaceAll('data-ticket-card=""','data-ticket-card="" hidden'),fixture.replaceAll('3995,- NOK','TBA')])assert.equal(parse(html).ticketStatus,undefined);
});

test('sold-out conference bundle does not override regular pass; sold-out regular pass does',()=>{
 assert.equal(parse(fixture.replace('4 Day Festival + 3 Day Conference','Sold Out: 4 Day Festival + 3 Day Conference')).ticketStatus,'available');assert.equal(parse(fixture.replace('3995,- NOK','3995,- NOK Sold Out')).ticketStatus,'unavailable');
});

test('invalid or conflicting pass dates fail closed',()=>{
 for(const date of ['March 30-33th 2027','March 28-25th 2027','February 27-30th 2027','March 24-28th 2027','March 25-28th 2026'])assert.equal(parse(fixture.replaceAll('March 25-28th 2027',date)).startDate,undefined);
 const card=fixture.match(/<a data-ticket-card=""[^>]*data-track-label="2027 - 4 Day Festival Pass"[\s\S]*?<\/a>/)[0];const c=parse(fixture+card.replaceAll('March 25-28th','March 26-29th'));assert.equal(c.startDate,undefined);assert.equal(c.ticketStatus,undefined);assert.ok(c.warnings[0].includes('Conflicting'));
});

test('ambiguous/missing current announcement section cannot replace verified lineup',()=>{
 for(const html of [fixture.replaceAll('Lineup in progress','Old lineup'),fixture+fixture.slice(fixture.indexOf('<section class='))])assert.equal(parse(html).lineup,undefined);
});

test('official source identities/routes are scoped and not hijacked by unrelated sources',()=>{
 for(const url of ['https://evil.example/','https://www.infernofestival.net/artists','https://www.infernofestival.net/?year=2026'])assert.equal(extractInfernoCandidate(fixture,{...source,url},at),undefined);assert.equal(extractInfernoCandidate(fixture,{...source,festivalSlug:'other'},at),undefined);assert.equal(extractInfernoCandidate(fixture.replace('INFERNO 2027','Other festival 2027'),source,at),undefined);
});

test('real .net to official .no redirect is supported; unrelated host or archive redirect is rejected',async()=>{
 for(const url of ['https://infernofestival.no/','https://evil.example/','https://infernofestival.no/?year=2026']){
 const response=new Response(fixture);Object.defineProperty(response,'url',{value:url});const run=()=>fetchSource(source,{fetchImpl:async()=>response});if(url==='https://infernofestival.no/')assert.equal(parse(await(await run()).response.text()).lineup.length,30);else await assert.rejects(run,/redirected away/);
 }
});

test('real provider/network failure stays a failed source check',async()=>{
 const r=await fetchSource(source,{maxAttempts:1,fetchImpl:async()=>new Response('blocked',{status:403})});assert.equal(r.response.status,403);assert.equal(r.attempts,1);await assert.rejects(fetchSource(source,{maxAttempts:1,fetchImpl:async()=>{throw new Error('network');}}),/network/);
});


test('an archived lineup section under a refreshed hero is not a current announcement',()=>{
 const c=parse(fixture.replace('Announcements continue','Inferno 2026 announcements continue'));assert.equal(c.lineup,undefined);assert.ok(c.warnings[0].includes('another edition'));
});

test('HTML entity apostrophes reconcile with the independently reviewed canonical artist',()=>{
 for(const punctuation of ['&rsquo;','&#39;','&#x27;'])assert.deepEqual(changes(parse(fixture.replace("Master's Hammer",'Master'+punctuation+'s Hammer'))).changes,[]);
});
