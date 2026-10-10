import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
import { parserSource } from './support/parser-source.ts';
const html = await readFile(new URL('./fixtures/masters-of-rock-2027-home.html', import.meta.url), 'utf8');
const source = parserSource('masters-of-rock', { url: 'https://www.mastersofrock.cz/', strategies: ['json_ld_event', 'html_fallback'] });
const parse = (value = html, s = source) => extractFestivalCandidate(value, s, '2026-10-10T14:39:00Z');
const expected = ['Judas Priest','Slash','Bruce Dickinson','Skillet','Alestorm','Amaranthe','Lord Of The Lost','Therion','Dartagnan','Septicflesh','Freedom Call','Gaerea','Eclipse','Crematory','Nervosa','April Art','Emil Bulls','Samurai Pizza Cats','Vindicta','Die Happy','Melissa Bonny','Wizardthrone','Roses of Thieves','Seasons In Black','Doga'];
const current = { slug: 'masters-of-rock', editionYear: 2027, city: 'Vizovice', startDate: '2027-07-08', endDate: '2027-07-11', status: 'partial', lineup: expected, headliners: [], ticketsUrl: 'https://www.mastersofrock.cz/cs/masters-of-rock-vstupenky', ticketStatus: 'available' };

test('real corrected home extracts all 25 unranked acts, dates and festival tickets, not headings or merchandise', () => {
  const c = parse();
  assert.deepEqual(c.lineup, expected);
  assert.equal(c.headliners, undefined);
  assert.equal(c.status, 'partial');
  assert.equal(c.startDate, current.startDate);
  assert.equal(c.endDate, current.endDate);
  assert.equal(c.ticketsUrl, current.ticketsUrl);
  assert.equal(c.ticketStatus, 'available');
  assert.deepEqual(c.observedEditionYears, [2027]);
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(evaluateCandidate(current, c).changes, []);
  assert.deepEqual(evaluateCandidate(current, c).reviewReasons, []);
});

test('later additions, apostrophes, ampersands and reordered artists are not frozen to the corrected document', () => {
  const c = parse(html.replace('<span data-mor-band>Judas Priest</span>', '<span data-mor-band>New &amp; Future Band</span><span data-mor-band>Judas Priest</span><span data-mor-band>Artist&#39;s Project</span>'));
  assert.deepEqual(c.lineup, ['New & Future Band', 'Judas Priest', "Artist's Project", ...expected.slice(1)]);
  assert.equal(c.status, 'partial');
  const decision = evaluateCandidate(current, c);
  assert.equal(decision.publishable, true);
  assert.deepEqual(decision.reviewReasons, []);
  assert.deepEqual(decision.changes.map(x => x.kind), ['artist_added', 'artist_added']);
});

test('future edition changes require matching source edition, and invalid dates fail closed', () => {
  const future = html.replaceAll('2027', '2028').replace('08–11.07.2028', '06–09.07.2028');
  assert.equal(parse(future).lineup, undefined);
  assert.ok(parse(future).warnings.some(x => x.includes('does not match')));
  const c = parse(future, { ...source, editionYear: 2028 });
  assert.equal(c.startDate, '2028-07-06');
  assert.equal(c.endDate, '2028-07-09');
  assert.deepEqual(c.lineup, expected);
  assert.equal(c.ticketStatus, 'available');
  assert.deepEqual(c.warnings, []);
  assert.equal(parse(html.replace('08–11.07.2027', '30–31.02.2027')).lineup, undefined);
});

test('comments/news/featured cards and duplicate heroes cannot contaminate current performers', () => {
  const poisoned = '<!--<aside class="mor-hero-side"><span data-mor-band>Archived Artist</span></aside>-->' + html + '<section class="mor-news-section"><span data-mor-band>Unrelated Concert</span></section>';
  assert.deepEqual(parse(poisoned).lineup, expected);
  assert.equal(parse(html.replace(/data-mor-band/g, 'data-not-a-band')).lineup, undefined);
  assert.ok(parse(html.replace(/data-mor-band/g, 'data-not-a-band')).warnings.length);
  assert.equal(parse(html.replace('data-mor-state="active"', 'data-mor-state="archived"')).lineup, undefined);
  const hero = html.match(/<aside\b[\s\S]*?<\/aside>/)[0];
  assert.equal(parse(html + hero).lineup, undefined);
});

test('missing, disabled, archived and sold-out purchase cards do not infer availability from a price deadline', () => {
  for (const variant of [html.replaceAll('Koupit vstupenku ↗', 'Informace'), html.replaceAll('class="btn btn-primary">Koupit vstupenku', 'aria-disabled="true" class="btn btn-primary">Koupit vstupenku'), html.replaceAll('/cs/koncerty/2027-masters-of-rock', '/cs/koncerty/2026-masters-of-rock'), html.replace('Na stání</h3>', 'Na stání vyprodáno</h3>')]) {
    assert.equal(parse(variant).ticketStatus, undefined);
  }
  assert.equal(parse(html.replaceAll('/cs/masters-of-rock-vstupenky', '/cs/e-shop/')).ticketsUrl, undefined);
  assert.equal(parse(html.replaceAll('/cs/masters-of-rock-vstupenky', 'https://other.example/cs/masters-of-rock-vstupenky')).ticketsUrl, undefined);
});

test('partial list shrinkage stays review-required and cannot overwrite independently verified acts', () => {
  const c = parse(html.replace('<span data-mor-band>Doga</span>', ''));
  const d = evaluateCandidate(current, c);
  assert.equal(d.publishable, false);
  assert.ok(d.reviewReasons.includes('Removals require confirmation'));
});
