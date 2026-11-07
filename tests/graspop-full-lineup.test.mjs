import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
import {discoverGraspopAnnouncements,GRASPOP_FAQ} from '../lib/ingestion/adapters/graspop.ts';
import {parserSource} from './support/parser-source.ts';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/graspop-current/full-announcement.json',import.meta.url),'utf8'));
const source=parserSource('graspop',{url:GRASPOP_FAQ});
const parse=e=>extractFestivalCandidate(JSON.stringify(e),source,'2026-11-07T08:00:00.000Z');
const heads=['blink-182','Evanescence','Faith No More','Helloween','Marilyn Manson','Mötley Crüe','Parkway Drive','Slash ft. Myles Kennedy & The Conspirators'];
const current={slug:'graspop',editionYear:2027,startDate:'2027-06-17',endDate:'2027-06-20',status:'partial',ticketStatus:'unknown',headliners:heads,lineup:[]};
test('real November full bill: 102 support acts corroborated by dated official announcement, eight independently billed heads',()=>{
 const e=fixture();assert.equal(discoverGraspopAnnouncements(e.home).length,9);
 const c=parse(e);assert.deepEqual(c.warnings,[]);assert.equal(c.lineup.length,102);assert.deepEqual([...c.headliners].sort(),[...heads].sort());
 assert.ok(c.lineup.includes('Body Count Feat. Ice-T'));assert.ok(c.lineup.includes("Humanity's Last Breath"));
 const p=evaluateCandidate(current,c);assert.deepEqual(p.reviewReasons,[]);assert.equal(p.publishable,true);assert.equal(p.changes.filter(c=>c.kind==='artist_added').length,102);
 assert.equal(c.ticketStatus,undefined);assert.equal(c.ticketsUrl,undefined);assert.equal(c.artistListMode,'additive');
 assert.equal(evaluateCandidate({...current,lineup:c.lineup},c).changes.length,0);
});
test('expanded bill fails closed on missing proof, wrong year/date, count drift, roster truncation, foreign identity and ambiguous billing',()=>{
 for(const mutate of [
 e=>{e.home=e.home.replace('102 new acts confirmed','102 acts confirmed');e.articles.shift();},
 e=>e.articles[0].html=e.articles[0].html.replaceAll('2027','2026'),
 e=>e.articles[0].html=e.articles[0].html.replace('From 17- 20 June','From 18- 21 June'),
 e=>e.articles[0].html=e.articles[0].html.replace('102 new acts confirmed','101 new acts confirmed'),
 e=>e.articles[0].html=e.articles[0].html.replace('A.A. Williams,','Unknown Act,'),
 e=>e.roster=e.roster.replace(/<li class="artists-list__item">[\s\S]*?<\/li>/,''),
 e=>e.articles[0].html=e.articles[0].html.replace('Here is the full list','They have cancelled. Here is the full list'),
 e=>e.roster=e.roster.replace('/en/bands/a-a-williams','https://evil.test/en/bands/a-a-williams'),
 ]) {const e=fixture();mutate(e);const c=parse(e);assert.ok(c.warnings.length);assert.equal(c.lineup,undefined);}
 const c=parse(fixture());assert.ok(evaluateCandidate({...current,lineup:['blink-182']},c).reviewReasons.length);
 assert.ok(evaluateCandidate({...current,headliners:[...heads,'A.A. Williams']},c).reviewReasons.length);
});
test('later full announcements use declared counts rather than freezing this capture; missing artists never delete saved entries',()=>{
 const e=fixture();e.home=e.home.replace('102 new acts confirmed','103 new acts confirmed');
 e.articles[0].html=e.articles[0].html.replace('102 new acts confirmed','103 new acts confirmed').replace('A.A. Williams,','Future Support, A.A. Williams,');
 const card=e.roster.match(/<li class="artists-list__item">[\s\S]*?<\/li>/)[0];
 e.roster=e.roster.replace('</ol>',card.replaceAll('A.A. Williams','Future Support').replaceAll('a-a-williams','future-support')+'</ol>');
 const c=parse(e);assert.deepEqual(c.warnings,[]);assert.equal(c.lineup.length,103);assert.ok(c.lineup.includes('Future Support'));
 const p=evaluateCandidate({...current,lineup:['Previously Confirmed Act']},c);
 assert.deepEqual(p.reviewReasons,[]);assert.equal(p.changes.some(c=>c.kind.includes('removed')),false);
 const broken=structuredClone(c);broken.evidence=broken.evidence.filter(e=>e.field!=='lineup');assert.ok(evaluateCandidate(current,broken).reviewReasons.length);
});

test('roster apostrophe typography preserves existing catalogue identity and replay',()=>{
 const e=fixture();
 const c=parse(e);
 assert.ok(c.lineup.includes("Humanity's Last Breath"));
 assert.ok(!c.lineup.includes('Humanity’s Last Breath'));
 const again=parse({...e,roster:e.roster.replaceAll('Humanity’s Last Breath',"Humanity's Last Breath")});
 assert.deepEqual(again.lineup,c.lineup);
 assert.equal(evaluateCandidate({...current,lineup:c.lineup},again).changes.length,0);
});
