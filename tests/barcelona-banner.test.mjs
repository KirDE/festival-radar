import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractFestivalCandidate } from '../lib/ingestion/extract.ts';
import { evaluateCandidate } from '../lib/ingestion/policy.ts';
const html = readFileSync(new URL('./fixtures/barcelona-current-banner.html', import.meta.url), 'utf8');
const source = { festivalSlug: 'barcelona-rock-fest', url: 'https://www.barcelonarockfest.com/', strategies: ['json_ld_event', 'html_fallback'], enabled: true, editionYear: 2027, refreshPolicy: 'daily' };
const parse = (document = html, config = source) => extractFestivalCandidate(document, config, '2026-10-10T15:40:00Z');
test('actual corrected Barcelona banner gives all four days and current sales, never stale FAQ or old lineup images', () => {
  const c = parse();
  assert.equal(c.startDate, '2027-07-01'); assert.equal(c.endDate, '2027-07-04');
  assert.equal(c.ticketsUrl, 'https://www.barcelonarockfest.com/en/tickets'); assert.equal(c.ticketStatus, 'available');
  assert.deepEqual(c.observedEditionYears, [2027]); assert.deepEqual(c.warnings, []);
  assert.equal(c.lineup, undefined); assert.equal(c.headliners, undefined); assert.equal(c.status, undefined);
  const current = { slug: source.festivalSlug, editionYear: 2027, startDate: c.startDate, endDate: c.endDate, ticketsUrl: c.ticketsUrl, ticketStatus: 'available', status: 'partial', headliners: ['Verified headliner'], lineup: ['Verified support'] };
  const result = evaluateCandidate(current, c); assert.deepEqual(result.changes, []); assert.deepEqual(result.reviewReasons, []);
});
test('later official dates and localized sales change dynamically without a bill or hash allowlist', () => {
  const c = parse(html.replace('1 - 2 - 3 - 4 julio 2027', '5 - 6 - 7 juliol 2028').replace('tickets ya a la venta', 'entrades ja a la venda'), { ...source, editionYear: 2028 });
  assert.equal(c.startDate, '2028-07-05'); assert.equal(c.endDate, '2028-07-07'); assert.equal(c.ticketStatus, 'available');
  const en = parse(html.replace('julio', 'July').replace('tickets ya a la venta', 'Tickets now on sale').replace('/tickets"', '/en/tickets"'));
  assert.equal(en.ticketStatus, 'available'); assert.equal(en.ticketsUrl, 'https://www.barcelonarockfest.com/en/tickets');
});
test('stale, conflicting, nonconsecutive, impossible or unmarked dates cannot establish current dates or sales', () => {
  for (const bad of [html.replace('2027', '2026'), html.replace('1 - 2 - 3 - 4', '1 - 3 - 4'), html.replace('1 - 2 - 3 - 4 julio', '30 - 31 febrero'), html.replace('1 - 2 - 3 - 4', '99'), html.replace('par-2', 'faq-date'), html + '<h2 class="par-2">2 - 3 julio 2027</h2>']) {
    const c = parse(bad); assert.equal(c.startDate, undefined); assert.equal(c.endDate, undefined); assert.equal(c.ticketStatus, undefined);
  }
});
test('old official edition is surfaced to the policy even when current dates and sales are withheld', () => {
  const c = parse(html.replace('2027', '2026'));
  assert.deepEqual(c.observedEditionYears, [2026]);
  const result = evaluateCandidate({ slug: source.festivalSlug, editionYear: 2027, lineup: [], headliners: [] }, c);
  assert.ok(result.reviewReasons.some(reason => reason.includes('2026')));
});
test('tranche exhaustion and ambiguous sales headings do not imply general availability or full sellout', () => {
  for (const notice of ['EARLY BIRD TICKETS SOLD OUT', 'Tickets sold out', 'Tickets on sale soon']) {
    assert.equal(parse(html.replace('tickets ya a la venta', notice)).ticketStatus, undefined);
  }
  assert.equal(parse(html + '<h2 class="par-3">Tickets sold out</h2>').ticketStatus, undefined);
});
test('festival and official-host scope prevent generic headings from affecting other sources', () => {
  for (const config of [{ ...source, festivalSlug: 'other' }, { ...source, url: 'https://example.test/' }]) {
    assert.equal(parse(html, config).startDate, undefined); assert.equal(parse(html, config).ticketStatus, undefined);
  }
});
