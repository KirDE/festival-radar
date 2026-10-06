import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BOUNDS, guardHead, normalizedFingerprint, parseArgs, readReviewQueue, runCli, safeUrl } from '../lib/ingestion/review-queue.mjs';

const HEAD = 'a'.repeat(40);
const source = (overrides = {}) => ({ id: 's1', festivalId: 'f1', editionId: 'e1', festivalSlug: 'rock', url: 'https://official.test/', enabled: true, strategies: ['manual_review'], parserKey: 'manual_review', editionYear: 2026, createdAt: '2026-01-01', updatedAt: '2026-01-01', configurationBackfilledAt: '2026-01-01', ...overrides });
const attempt = (overrides = {}) => ({ id: 'a1', runId: 'r1', festivalSlug: 'rock', requestedUrl: 'https://official.test/', finalUrl: 'https://official.test/', status: 'REVIEW', startedAt: '2026-02-01', endedAt: '2026-02-02', ...overrides });
const candidate = (overrides = {}) => ({ id: 'c1', runId: 'r1', attemptId: 'a1', festivalSlug: 'rock', schemaVersion: 1, sourceYear: 2026, createdAt: '2026-02-02', normalized: { lineup: ['A'], city: 'Secret city' }, attempt: attempt(), evidence: [], ...overrides });
function fakeDb(sources = [], candidates = [], attempts = []) {
  const calls = [];
  return {
    calls,
    festivalSource: { findMany: async (query) => { calls.push(['source', query]); return sources; } },
    ingestionCandidate: { findMany: async (query) => { calls.push(['candidate', query]); return candidates; } },
    ingestionAttempt: { findFirst: async (query) => {
      calls.push(['attempt', query]);
      return attempts.filter((a) => a.festivalSlug === query.where.festivalSlug && a.requestedUrl === query.where.requestedUrl)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt) || new Date(b.endedAt) - new Date(a.endedAt) || b.id.localeCompare(a.id))[0] ?? null;
    } },
  };
}

test('includes all nine enabled manual sources without attempts', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => source({ id: `s${i}`, url: `https://official.test/${i}` }));
  rows.push(source({ id: 'disabled', enabled: false }), source({ id: 'auto', strategies: ['html_fallback'] }));
  const result = await readReviewQueue(fakeDb(rows));
  assert.equal(result.manualSourceCount, 9);
  assert.equal(result.entries.length, 9);
  assert.ok(result.entries.every((e) => e.actionable && e.candidate === null && e.latestAttempt === null));
});

test('deduplicates attempts per exact configured source, retains multiple URLs per festival', async () => {
  const older = candidate({ id: 'old', attemptId: 'old-a', attempt: attempt({ id: 'old-a', startedAt: '2026-01-02' }) });
  const other = candidate({ id: 'other', attemptId: 'other-a', attempt: attempt({ id: 'other-a', requestedUrl: 'https://official.test/other' }) });
  const db = fakeDb([source({ strategies: ['html_fallback'] }), source({ id: 's2', url: 'https://official.test/other', strategies: ['html_fallback'] })], [older, other, candidate()], [older.attempt, other.attempt, attempt()]);
  const result = await readReviewQueue(db);
  assert.equal(result.entries.length, 2);
  const first = result.entries.find((e) => e.source.id === 's1');
  assert.equal(first.candidate.id, 'c1');
  assert.equal(first.suppressedCandidateCount, 1);
  assert.equal(first.actionable, true);
  assert.equal(db.calls.filter(([kind]) => kind === 'attempt').length, 2);
});

test('newer attempt of any status stales pending review; manual source remains actionable', async () => {
  for (const status of ['FAILED', 'UNCHANGED', 'PUBLISHABLE', 'REVIEW']) {
    const newer = attempt({ id: 'new', status, startedAt: '2026-03-01' });
    for (const manual of [true, false]) {
      const result = await readReviewQueue(fakeDb([source({ strategies: manual ? ['manual_review'] : ['html_fallback'] })], [candidate()], [attempt(), newer]));
      const e = result.entries[0];
      assert.deepEqual(e.candidate.staleReasons, ['newer_attempt']);
      assert.equal(e.latestAttempt.id, 'new');
      assert.equal(e.actionable, manual);
    }
  }
});

test('configuration update, edition change, disabled or missing sources mark stale', async () => {
  for (const [rows, reason] of [
    [[source({ updatedAt: '2026-03-01' })], 'source_updated_after_attempt'],
    [[source({ editionYear: 2027 })], 'edition_changed'],
    [[source({ enabled: false })], 'source_disabled'],
    [[], 'source_missing_or_url_changed'],
    [[source({ url: 'https://official.test/changed' })], 'source_missing_or_url_changed'],
  ]) {
    const result = await readReviewQueue(fakeDb(rows, [candidate()], [attempt()]));
    const e = result.entries.find((item) => item.candidate);
    assert.equal(e.candidate.stale, true);
    assert.ok(e.candidate.staleReasons.includes(reason));
  }
});

test('query bounds and nested evidence are explicit; truncation fails closed', async () => {
  const db = fakeDb([source()], [candidate()], [attempt()]);
  await readReviewQueue(db);
  const sq = db.calls.find(([kind]) => kind === 'source')[1];
  const cq = db.calls.find(([kind]) => kind === 'candidate')[1];
  assert.equal(sq.take, BOUNDS.sources + 1);
  assert.equal(cq.take, BOUNDS.candidates + 1);
  assert.deepEqual(cq.where, { reviewState: 'PENDING', attempt: { status: 'REVIEW' } });
  assert.equal(cq.select.evidence.take, BOUNDS.evidence + 1);
  assert.equal(cq.select.evidence.select.excerpt, undefined);
  assert.equal(sq.select.requestHeaders, undefined);
  await assert.rejects(readReviewQueue(fakeDb(Array(BOUNDS.sources + 1).fill(source()))), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([], Array(BOUNDS.candidates + 1).fill(candidate()))), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([], [candidate({ evidence: Array(BOUNDS.evidence + 1).fill({}) })])), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([source(), source({ id: 's2', url: 'https://other.test/' })]), { limit: 1 }), /exceeds limit/);
});

test('redacts credentials, query, fragment and freeform data; exports hash provenance only', async () => {
  const url = 'https://user:password@official.test/path?token=secret#fragment-secret';
  const a = attempt({ requestedUrl: url, finalUrl: url, error: 'error-secret', parserVersions: { authorization: 'header-secret' } });
  const c = candidate({ attempt: a, warnings: ['warning-secret'], normalized: { city: 'normalized-secret' }, evidence: [{ id: 'ev1', field: 'lineup', adapter: 'festival-extractor-v1', contentHash: 'b'.repeat(64), observedAt: '2026-02-01', sourceUrl: url, observedValue: 'value-secret', excerpt: 'excerpt-secret' }] });
  const result = await readReviewQueue(fakeDb([source({ url, fetchUrl: url, requestHeaders: { Authorization: 'header-secret' }, manualReviewReason: 'reason-secret', lastError: 'last-secret' })], [c], [a]));
  const json = JSON.stringify(result);
  for (const secret of ['password', 'user:', 'token=', 'fragment-secret', 'error-secret', 'header-secret', 'warning-secret', 'normalized-secret', 'value-secret', 'excerpt-secret', 'reason-secret', 'last-secret']) assert.ok(!json.includes(secret), secret);
  const e = result.entries[0].candidate.evidence[0];
  assert.equal(e.field, 'lineup');
  assert.equal(e.adapter, 'festival-extractor-v1');
  assert.equal(e.contentHash, 'b'.repeat(64));
  assert.equal(e.observedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(e.sourceUrl, 'https://official.test/path');
  assert.equal(result.entries[0].candidate.normalizedFingerprint, normalizedFingerprint(c.normalized));
  assert.equal(safeUrl('javascript:secret'), null);
  assert.equal(safeUrl('not a url'), null);
});

test('normalized fingerprint is SHA-256 of canonical JSON, sensitive to content and array order', () => {
  assert.equal(normalizedFingerprint({ b: [1, { z: 3, a: 2 }], a: 1 }), normalizedFingerprint({ a: 1, b: [1, { a: 2, z: 3 }] }));
  assert.match(normalizedFingerprint({ a: 1 }), /^[a-f0-9]{64}$/);
  assert.notEqual(normalizedFingerprint([1, 2]), normalizedFingerprint([2, 1]));
  assert.notEqual(normalizedFingerprint({ a: 1 }), normalizedFingerprint({ a: 2 }));
});

test('strict args and bounded limits', () => {
  assert.deepEqual(parseArgs([`--expected-head=${HEAD}`]), { expectedHead: HEAD, limit: 50 });
  assert.equal(parseArgs([`--expected-head=${HEAD}`, '--limit=100']).limit, 100);
  for (const args of [[], ['--expected-head=ff13e8cc'], [`--expected-head=${HEAD}`, '--other=1'], [`--expected-head=${HEAD}`, '--limit=0'], [`--expected-head=${HEAD}`, '--limit=101'], [`--expected-head=${HEAD}`, '--limit=01'], [`--expected-head=${HEAD}`, '--limit=1.5'], [`--expected-head=${HEAD}`, '--limit=2', '--limit=3'], [`--expected-head=${HEAD}`, `--expected-head=${HEAD}`]]) assert.throws(() => parseArgs(args));
  assert.throws(() => guardHead(HEAD, () => 'b'.repeat(40)), /mismatch/);
});

test('guards run before connecting; stdout sanitized on all failures', async () => {
  let connected = 0;
  for (const [args, env, actual, message] of [
    [[], { DATABASE_URL: 'secret' }, HEAD, /expected-head/],
    [[`--expected-head=${HEAD}`], { DATABASE_URL: 'secret' }, 'b'.repeat(40), /mismatch/],
    [[`--expected-head=${HEAD}`], {}, HEAD, /DATABASE_URL/],
  ]) {
    let output;
    const code = await runCli(args, env, { readHead: () => actual, connect: async () => { connected++; }, output: (s) => { output = s; } });
    assert.equal(code, 1); assert.match(JSON.parse(output).error, message);
  }
  assert.equal(connected, 0);
  let output;
  assert.equal(await runCli([`--expected-head=${HEAD}`], { DATABASE_URL: 'secret' }, { readHead: () => HEAD, connect: async () => { throw new Error('postgres://password@host?token=secret'); }, output: (s) => { output = s; } }), 1);
  assert.equal(JSON.parse(output).error, 'Review queue export failed');
});

test('successful CLI uses a read-only snapshot, disconnects and returns only JSON', async () => {
  const db = fakeDb([source()]);
  const commands = [];
  db.$executeRawUnsafe = async (sql) => { commands.push(sql); };
  db.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return fn(db); };
  db.$disconnect = async () => { commands.push('disconnect'); };
  let output;
  assert.equal(await runCli([`--expected-head=${HEAD}`], { DATABASE_URL: 'secret' }, { readHead: () => HEAD, connect: async () => db, output: (s) => { output = s; } }), 0);
  assert.deepEqual(commands, ['SET TRANSACTION READ ONLY', 'disconnect']);
  assert.equal(JSON.parse(output).expectedHead, HEAD);
  assert.equal(JSON.parse(output).entries.length, 1);
});

test('real CLI invalid args emits JSON on stdout with empty stderr without dependencies', (t) => {
  const result = spawnSync(process.execPath, ['scripts/export-ingestion-review-queue.mjs', '--expected-head=invalid'], { encoding: 'utf8' });
  if (result.error?.code === 'EPERM') { t.skip('Sandbox prohibits child process execution'); return; }
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.match(JSON.parse(result.stdout).error, /expected-head/);
});

test('CLI scan failure emits no partial queue and always disconnects', async () => {
  const db = fakeDb(Array(BOUNDS.sources + 1).fill(source()));
  let disconnected = false;
  db.$executeRawUnsafe = async () => {};
  db.$transaction = async (fn) => fn(db);
  db.$disconnect = async () => { disconnected = true; };
  const outputs = [];
  const code = await runCli([`--expected-head=${HEAD}`], { DATABASE_URL: 'secret' }, { readHead: () => HEAD, connect: async () => db, output: (s) => outputs.push(s) });
  assert.equal(code, 1);
  assert.equal(disconnected, true);
  assert.equal(outputs.length, 1);
  assert.deepEqual(JSON.parse(outputs[0]), { error: 'Scan truncated; no queue exported' });
});
