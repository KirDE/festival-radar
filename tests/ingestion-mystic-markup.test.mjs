import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const html = readFileSync(new URL('./fixtures/mystic-2027-home.html', import.meta.url), 'utf8');
const source = {festivalSlug:'mystic',url:'https://www.mysticfestival.pl/',editionYear:2027,strategies:['json_ld_event','html_fallback'],enabled:true,refreshPolicy:'every_3_days'};
const parse = (document=html, overrides={}) => extractFestivalCandidate(document,{...source,...overrides},'2026-10-10T15:00:00Z');
const current = {slug:'mystic',editionYear:2027,headliners:['Faith No More'],lineup:['Lorna Shore','Watain','Converge','Green Lung'],status:'partial',startDate:'2027-06-10',endDate:'2027-06-12',ticketsUrl:source.url,ticketStatus:'available'};
test('real corrected Mystic case splits artist links, binds edition and preserves verified billing/gateway',()=>{
 const c=parse(); assert.deepEqual(c.headliners,current.headliners); assert.deepEqual(c.lineup,current.lineup);
 for(const k of ['startDate','endDate','status','ticketStatus','ticketsUrl'])assert.equal(c[k],current[k]);
 assert.deepEqual(c.observedEditionYears,[2027]); assert.deepEqual(c.warnings,[]);
 const r=evaluateCandidate(current,c); assert.deepEqual(r.changes,[]); assert.deepEqual(r.reviewReasons,[]);
});
test('later artist and explicit headliner announcements are data, not hardcoded bill/hash',()=>{
 let later=html.replace('</div>','<a href="/artist/new-act/">New &amp; Act</a><a href="https://evil.test/artist/spam/">Spam</a></div>')
  .replace('Faith No More pierwszym','New &amp; Act kolejnym');
 const c=parse(later); assert.deepEqual(c.headliners,['New & Act']); assert.deepEqual(c.lineup,['Faith No More',...current.lineup]); assert.equal(c.status,'partial');
 assert.deepEqual(c.warnings,[]);
});
test('artist container ignores duplicates, historical prose, scripts and comments',()=>{
 const c=parse(html.replace('</div>','<a href="/artist/green-lung/">Green Lung</a></div>')+'<p>Gościliśmy Iron Maiden, Slayer</p><!--<div class="band_list"><a href="/artist/fake/">Fake</a></div>--><script>"<div class=\"band_list\"><a href=\"/artist/script/\">Script</a></div>"</script>');
 assert.deepEqual(c.lineup,current.lineup);
});
test('wrong/absent/ambiguous/invalid edition date cannot replace verified facts',()=>{
 for(const text of [html.replaceAll('2027','2026'),html.replace('10-12.06.2027',''),html.replace('10-12.06.2027','31-32.06.2027'),html+'<span class="elementor-heading-title">11-13.06.2027</span>']){
 const c=parse(text);assert.equal(c.lineup,undefined);assert.equal(c.ticketsUrl,undefined);assert.ok(c.warnings.length);
 }
 assert.equal(parse(html,{editionYear:2028}).lineup,undefined);
});
test('missing billing does not demote a known headliner; no sale evidence means no availability guess',()=>{
 const c=parse(html.replace('pierwszym headlinerem','potwierdzony'));assert.equal(c.headliners,undefined);assert.equal(c.lineup,undefined);assert.ok(c.warnings.length);
 assert.equal(parse(html.replace('bilety Early Bird już w sprzedaży','Do zobaczenia')).ticketStatus,undefined);
 assert.equal(parse(html.replace('bilety Early Bird już w sprzedaży','bilety wyprzedane')).ticketStatus,'sold_out');
});
test('no unconfigured purchase host or non-home source is trusted',()=>{
 assert.equal(parse(html.replace('https://tickets.mysticfestival.pl/pl/','https://evil.test/')).ticketsUrl,undefined);
 assert.equal(parse(html,{url:source.url+'history/'}).lineup,undefined);
});

test('only explicit current-edition full-bill wording upgrades completeness',()=>{
 assert.equal(parse(html+'<h2 class="elementor-heading-title">Pełny skład Mystic Festival 2027</h2>').status,'confirmed');
 assert.equal(parse(html+'<h2 class="elementor-heading-title">Pełny skład Mystic Festival 2026</h2>').status,'partial');
});
