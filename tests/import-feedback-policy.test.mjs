import assert from 'node:assert/strict';
import test from 'node:test';
import { failureRetryAt, DEPRECATED_AFTER_MS } from '../lib/ingestion/failure-policy.ts';
import { extractHtmlFallbackCandidate } from '../lib/ingestion/adapters/html-fallback.ts';
const now = new Date('2026-10-10T00:00:00Z');
test('failure backoff uses exactly 1h,6h,1d,3d,1w and stays weekly', () => {
  [1,6,24,72,168,168].forEach((hours,i) => assert.equal(failureRetryAt(i+1,now).getTime()-now.getTime(),hours*3600000));
  assert.equal(DEPRECATED_AFTER_MS, 21*86400000); assert.throws(() => failureRetryAt(0));
});
test('agent-ticket correction regression: merchandise/sponsor/transport shop never wins over genuine tickets', () => {
  const source = { festivalSlug:'hellfest',url:'https://hellfest.fr/',strategies:['html_fallback'],enabled:true,editionYear:2027,refreshPolicy:'daily' };
  const html = '<a href="https://shop.example/">Shop</a><a href="/merch/tickets">Merch tickets</a><a href="/transport-tickets">Transport tickets</a><a href="/tickets-2027">Tickets 2027</a>';
  assert.equal(extractHtmlFallbackCandidate(html,source,now.toISOString()).ticketsUrl,'https://hellfest.fr/tickets-2027');
  assert.equal(extractHtmlFallbackCandidate('<a href="/shop">Shop</a>',source,now.toISOString()).ticketsUrl,undefined);
});
