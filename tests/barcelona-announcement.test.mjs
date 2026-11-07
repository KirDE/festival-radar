import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { readFileSync } from 'node:fs';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
const source = { festivalSlug:'barcelona-rock-fest', url:'https://www.barcelonarockfest.com/', strategies:['json_ld_event','html_fallback'], enabled:true, editionYear:2027, refreshPolicy:'daily' };
const html = readFileSync(new URL('./fixtures/barcelona-announcement-en.html',import.meta.url),'utf8');
const parse = (h=html,s=source)=>extractFestivalCandidate(h,s,'2026-11-07T11:37:37Z');
for(const lang of ['en','es']) test(`actual ${lang} announcement excludes decorative label and old poster`,()=>{
 const c=parse(readFileSync(new URL(`./fixtures/barcelona-announcement-${lang}.html`,import.meta.url),'utf8'));
 assert.deepEqual(c.lineup,['Mötley Crüe']); assert.deepEqual(c.warnings,[]); assert.equal(c.headliners,undefined);
 assert.equal(c.startDate,'2027-07-01'); assert.equal(c.endDate,'2027-07-04'); assert.equal(c.completeness,undefined);
 assert.ok(c.evidence.some(e=>e.field==='lineup'&&e.excerpt.includes('Mötley Crüe')));
});
test('later act/year not hardcoded',()=>{
 const c=parse(html.replaceAll('2027','2028').replaceAll('Mötley Crüe','Future Band'),{...source,editionYear:2028});
 assert.deepEqual(c.lineup,['Future Band']); assert.equal(c.headliners,undefined); assert.equal(c.completeness,undefined);
});
test('stale announcement, script payload and other edition do not contribute artists',()=>{
 assert.equal(parse(html.replace('Rock Fest 2027','Rock Fest 2026')).lineup,undefined);
 assert.equal(parse(html,{...source,editionYear:2028}).lineup,undefined);
 assert.equal(parse(html.replace(/<h2 class="md:text-8xl[\s\S]*?<\/h2>/,'<script><h2>Mötley Crüe, Saturday, July 3rd at Barcelona Rock Fest 2027</h2></script>')).lineup,undefined);
});
test('malformed performer and unrelated festivals keep navigation safeguards',()=>{
 assert.ok(parse(html+'<span data-artist="line up">line up</span>').warnings.some(w=>w.includes('navigation')));
 assert.ok(parse(html,{...source,festivalSlug:'other'}).warnings.some(w=>w.includes('navigation')));
});

test('later dated confirmations are additive; out-of-range announcements ignored',()=>{
 const later='<h2>Later Band, Thursday, July 2nd at Barcelona Rock Fest 2027</h2>';
 assert.deepEqual(parse(html+later).lineup,['Mötley Crüe','Later Band']);
 assert.equal(parse(html.replace('July 3rd','July 9th')).lineup,undefined);
});

test('new additions gated; replay preserves verified supports and headline billing',()=>{
 const c=parse(),current={slug:source.festivalSlug,editionYear:2027,startDate:c.startDate,endDate:c.endDate,ticketsUrl:c.ticketsUrl,ticketStatus:c.ticketStatus,status:'partial',headliners:['Mötley Crüe'],lineup:['Verified Support']};
 const replay=evaluateCandidate(current,c);assert.deepEqual(replay.changes,[]);assert.deepEqual(replay.reviewReasons,[]);
 const fresh=evaluateCandidate({...current,headliners:[],lineup:[]},c);assert.equal(fresh.publishable,false);assert.ok(fresh.reviewReasons.length);assert.equal(fresh.changes.length,1);
});
