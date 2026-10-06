import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BOUNDS, guardHead, normalizedFingerprint, parseArgs, readReviewQueue, runCli, safeUrl, validatedDeployedRevision } from '../lib/ingestion/review-queue.mjs';

const HEAD = 'a'.repeat(40);

test('active stamped release is accepted without Git metadata, never a stale or mismatched release', () => {
  const root = '/opt/festival-radar/releases/' + HEAD;
  assert.equal(validatedDeployedRevision(root, root, HEAD), HEAD);
  assert.equal(validatedDeployedRevision(root, '/opt/festival-radar/releases/' + 'b'.repeat(40), HEAD), null);
  assert.equal(validatedDeployedRevision(root, root, 'b'.repeat(40)), null);
  assert.equal(validatedDeployedRevision(root + '/nested', root + '/nested', HEAD), null);
});
const source = (overrides = {}) => ({ id: 's1', festivalId: 'f1', editionId: 'e1', festivalSlug: 'rock', url: 'https://official.test/', enabled: true, strategies: ['manual_review'], parserKey: 'manual_review', editionYear: 2026, createdAt: '2026-01-01', updatedAt: '2026-01-01', configurationBackfilledAt: '2026-01-01', ...overrides });
const attempt = (overrides = {}) => ({ id: 'a1', runId: 'r1', festivalSlug: 'rock', requestedUrl: 'https://official.test/', finalUrl: 'https://official.test/', status: 'REVIEW', startedAt: '2026-02-01', endedAt: '2026-02-02', ...overrides });
const candidate = (overrides = {}) => ({ id: 'c1', runId: 'r1', attemptId: 'a1', festivalSlug: 'rock', schemaVersion: 1, sourceYear: 2026, createdAt: '2026-02-02', normalized: { lineup: ['A'], city: 'Secret city' }, attempt: attempt(), evidence: [], diffs: [{ field: 'lineup', reviewRequired: true, policyVersion: '2026-08-29' }], ...overrides });
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
      const e = result.entries.find((entry) => entry.kind === 'review_candidate');
      assert.deepEqual(e.candidate.staleReasons, ['newer_attempt']);
      assert.equal(e.latestAttempt.id, 'new');
      assert.equal(e.actionable, false);
      assert.equal(result.entries.some((entry) => entry.kind === 'unverified_source' && entry.actionable), manual);
    }
  }
});

test('routine due-scheduler completion does not stale its own review candidate', async () => {
  const current = source({ strategies: ['official_markup'], parserKey: 'official_markup:rock',
    updatedAt: '2026-02-02T12:00:00Z', lastAttemptAt: '2026-02-02T12:00:00Z' });
  const reviewed = attempt({ endedAt: '2026-02-02T11:59:59Z' });
  const result = await readReviewQueue(fakeDb([current], [candidate({ attempt: reviewed })], [reviewed]));
  assert.equal(result.entries[0].actionable, true);
  assert.deepEqual(result.entries[0].candidate.staleReasons, []);
  const changed = source({ ...current, updatedAt: '2026-02-02T12:00:01Z' });
  const uncertain = await readReviewQueue(fakeDb([changed], [candidate({ attempt: reviewed })], [reviewed]));
  assert.deepEqual(uncertain.entries[0].candidate.staleReasons, ['source_updated_after_attempt']);
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
  assert.equal(cq.select.diffs.take, BOUNDS.diffs + 1);
  assert.deepEqual(cq.select.diffs.select, { field: true, reviewRequired: true, policyVersion: true });
  assert.equal(sq.select.requestHeaders, undefined);
  await assert.rejects(readReviewQueue(fakeDb(Array(BOUNDS.sources + 1).fill(source()))), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([], Array(BOUNDS.candidates + 1).fill(candidate()))), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([], [candidate({ evidence: Array(BOUNDS.evidence + 1).fill({}) })])), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([], [candidate({ diffs: Array(BOUNDS.diffs + 1).fill({}) })])), /truncated/);
  await assert.rejects(readReviewQueue(fakeDb([source(), source({ id: 's2', url: 'https://other.test/' })]), { limit: 1 }), /exceeds limit/);
});

test('redacts credentials, query, fragment and freeform data; exports hash provenance only', async () => {
  const url = 'https://user:password@official.test/path?token=secret#fragment-secret';
  const a = attempt({ requestedUrl: url, finalUrl: url, error: 'error-secret', parserVersions: { authorization: 'header-secret' } });
  const c = candidate({ attempt: a, warnings: ['warning-secret'], normalized: { city: 'normalized-secret' }, evidence: [{ id: 'ev1', field: 'lineup', adapter: 'festival-extractor-v1', contentHash: 'b'.repeat(64), observedAt: '2026-02-01', sourceUrl: url, observedValue: 'value-secret', excerpt: 'excerpt-secret' }] });
  const result = await readReviewQueue(fakeDb([source({ url, fetchUrl: url, requestHeaders: { Authorization: 'header-secret' }, manualReviewReason: 'reason-secret', lastError: 'last-secret' })], [c], [a]));
  const json = JSON.stringify(result);
  for (const secret of ['password', 'user:', 'token=', 'fragment-secret', 'error-secret', 'header-secret', 'warning-secret', 'normalized-secret', 'value-secret', 'excerpt-secret', 'reason-secret', 'last-secret']) assert.ok(!json.includes(secret), secret);
  const review = result.entries.find((entry) => entry.kind === 'review_candidate');
  const e = review.candidate.evidence[0];
  assert.equal(e.field, 'lineup');
  assert.equal(e.adapter, 'festival-extractor-v1');
  assert.equal(e.contentHash, 'b'.repeat(64));
  assert.equal(e.observedAt, '2026-02-01T00:00:00.000Z');
  assert.equal(e.sourceUrl, 'https://official.test/path');
  assert.equal(review.candidate.normalizedFingerprint, normalizedFingerprint(c.normalized, c.evidence, c.diffs, c.sourceYear));
  assert.equal(safeUrl('javascript:secret'), null);
  assert.equal(safeUrl('not a url'), null);
});

test('meaningful fingerprint ignores observation metadata, preserves facts and array order', () => {
  const facts = { city: 'A', lineup: ['X', 'Y'], fetchedAt: '2026-01-01', warnings: ['static warning'], sourceUrl: 'https://old.test/', evidence: [{ observedAt: 'old' }], updatedAt: 'old' };
  const changedMetadata = { ...facts, fetchedAt: '2026-02-01', warnings: ['different'], sourceUrl: 'https://new.test/', evidence: [{ observedAt: 'new' }], updatedAt: 'new' };
  assert.equal(normalizedFingerprint(facts), normalizedFingerprint(changedMetadata));
  assert.match(normalizedFingerprint(facts), /^[a-f0-9]{64}$/);
  assert.notEqual(normalizedFingerprint(facts), normalizedFingerprint({ ...facts, city: 'B' }));
  assert.notEqual(normalizedFingerprint(facts), normalizedFingerprint({ ...facts, lineup: ['Y', 'X'] }));
  const timetable = { timetable: [{ date: '2026-06-01', start: '20:00', artist: 'X', sourceUrl: 'old', observedAt: 'old' }] };
  assert.equal(normalizedFingerprint(timetable), normalizedFingerprint({ timetable: [{ ...timetable.timetable[0], sourceUrl: 'new', observedAt: 'new' }] }));
  assert.notEqual(normalizedFingerprint(timetable), normalizedFingerprint({ timetable: [{ ...timetable.timetable[0], start: '21:00' }] }));
  assert.equal(normalizedFingerprint({ ticketsUrl: 'https://tickets.test/buy?ref=one' }), normalizedFingerprint({ ticketsUrl: 'https://tickets.test/buy?ref=two' }));
  assert.notEqual(normalizedFingerprint({ ticketsUrl: 'https://tickets.test/buy' }), normalizedFingerprint({ ticketsUrl: 'https://tickets.test/sold-out' }));
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

test('nine weekly manual sources with static warning repeats are nine unverified cases', async () => {
  const sources = Array.from({ length: 9 }, (_, i) => source({ id: `s${i}`, url: `https://official.test/${i}`, refreshPolicy: 'weekly' }));
  const candidates = sources.flatMap((s, i) => Array.from({ length: 4 }, (_, week) => {
    const a = attempt({ id: `a${i}-${week}`, requestedUrl: s.url, startedAt: `2026-02-${String(1 + week * 7).padStart(2, '0')}`, endedAt: `2026-02-${String(2 + week * 7).padStart(2, '0')}` });
    return candidate({ id: `c${i}-${week}`, attemptId: a.id, attempt: a, evidence: [], diffs: [], normalized: { warnings: ['static warning'], fetchedAt: a.endedAt } });
  }));
  const result = await readReviewQueue(fakeDb(sources, candidates, candidates.map((c) => c.attempt)));
  assert.equal(result.entries.length, 9);
  assert.equal(result.manualSourceCount, 9);
  for (const entry of result.entries) {
    assert.equal(entry.kind, 'unverified_source');
    assert.equal(entry.candidate, null);
    assert.equal(entry.placeholderCount, 4);
    assert.equal(entry.suppressedCandidateCount, 0);
    assert.equal(entry.latestAttempt.status, 'REVIEW');
    assert.match(entry.latestAttempt.id, /-3$/);
    assert.equal(entry.latestAttempt.startedAt, '2026-02-22T00:00:00.000Z');
  }
});

test('nonmanual warning-only candidates are source placeholders, never changes', async () => {
  for (const rows of [[source({ strategies: ['html_fallback'] })], []]) {
    const c = candidate({ evidence: [], diffs: [] });
    const result = await readReviewQueue(fakeDb(rows, [c], [c.attempt]));
    assert.equal(result.entries[0].kind, 'unverified_source');
    assert.equal(result.entries[0].candidate, null);
    assert.equal(result.entries[0].placeholderCount, 1);
    assert.equal(result.entries[0].latestAttempt.id, c.attemptId);
  }
});

const evidence = (overrides = {}) => ({ id: 'ev1', field: 'lineup', adapter: 'festival-extractor-v1', contentHash: 'b'.repeat(64), observedAt: '2026-02-01', sourceUrl: 'https://official.test/', ...overrides });
test('identical meaningful evidence deduplicates despite changed metadata and row ordering', async () => {
  const older = candidate({ id: 'old', attemptId: 'old-a', attempt: attempt({ id: 'old-a', startedAt: '2026-01-20' }),
    normalized: { lineup: ['A'], fetchedAt: 'old', warnings: ['old'], sourceUrl: 'https://old.test/' },
    evidence: [evidence(), evidence({ id: 'ev2', field: 'city', contentHash: 'c'.repeat(64) })] });
  const newer = candidate({ normalized: { lineup: ['A'], fetchedAt: 'new', warnings: ['new'], sourceUrl: 'https://new.test/' },
    evidence: [evidence({ id: 'ev-new2', field: 'city', contentHash: 'c'.repeat(64), observedAt: '2026-02-02', sourceUrl: 'https://new.test/' }), evidence({ id: 'ev-new1', observedAt: '2026-02-02' })] });
  assert.equal(normalizedFingerprint(older.normalized, older.evidence, older.diffs, older.sourceYear), normalizedFingerprint(newer.normalized, newer.evidence, newer.diffs, newer.sourceYear));
  const result = await readReviewQueue(fakeDb([source({ strategies: ['html_fallback'] })], [older, newer], [older.attempt, newer.attempt]));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].candidate.id, 'c1');
  assert.equal(result.entries[0].candidate.stale, false);
  assert.equal(result.entries[0].suppressedCandidateCount, 1);
});

test('distinct evidence fingerprints remain separate and older evidence stays stale', async () => {
  const older = candidate({ id: 'old', attemptId: 'old-a', attempt: attempt({ id: 'old-a', startedAt: '2026-01-20' }), evidence: [evidence({ contentHash: 'c'.repeat(64) })], diffs: [] });
  const newer = candidate({ evidence: [evidence()], diffs: [] });
  const result = await readReviewQueue(fakeDb([source({ strategies: ['html_fallback'] })], [older, newer], [older.attempt, newer.attempt]));
  assert.equal(result.entries.length, 2);
  assert.notEqual(result.entries[0].candidate.normalizedFingerprint, result.entries[1].candidate.normalizedFingerprint);
  const oldCase = result.entries.find((e) => e.candidate.id === 'old');
  assert.deepEqual(oldCase.candidate.staleReasons, ['newer_attempt']);
  assert.equal(oldCase.actionable, false);
  await assert.rejects(readReviewQueue(fakeDb([source()], [older, newer], [older.attempt, newer.attempt]), { limit: 1 }), /exceeds limit/);
});

test('diff-only reviews stay real; newer warning placeholder preserves historical evidence as stale', async () => {
  const real = candidate({ diffs: [{ field: 'lineup', reviewRequired: true, policyVersion: '2026-08-29', beforeValue: 'before-secret', afterValue: 'after-secret' }] });
  const placeholder = candidate({ id: 'placeholder', attemptId: 'later', attempt: attempt({ id: 'later', startedAt: '2026-03-01' }), evidence: [], diffs: [] });
  const result = await readReviewQueue(fakeDb([source({ strategies: ['html_fallback'] })], [placeholder, real], [placeholder.attempt, real.attempt]));
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.find((entry) => entry.kind === 'unverified_source').candidate, null);
  const e = result.entries.find((entry) => entry.kind === 'review_candidate');
  assert.equal(e.candidate.id, real.id);
  assert.equal(e.placeholderCount, 1);
  assert.equal(e.latestAttempt.id, 'later');
  assert.deepEqual(e.candidate.staleReasons, ['newer_attempt']);
  assert.deepEqual(e.candidate.diffs, [{ field: 'lineup', reviewRequired: true, policyVersion: '2026-08-29' }]);
  assert.ok(!JSON.stringify(result).includes('before-secret'));
  assert.ok(!JSON.stringify(result).includes('after-secret'));
});


test('manual source stays unverified beside historical evidence', async () => {
  const real = candidate({ evidence: [evidence()], diffs: [] });
  const weekly = candidate({ id: 'weekly', attemptId: 'weekly-a', attempt: attempt({ id: 'weekly-a', startedAt: '2026-03-01' }), evidence: [], diffs: [] });
  const result = await readReviewQueue(fakeDb([source()], [weekly, real], [weekly.attempt, real.attempt]));
  assert.equal(result.manualSourceCount, 1);
  assert.equal(result.entries.length, 2);
  const unverified = result.entries.find((entry) => entry.kind === 'unverified_source');
  assert.equal(unverified.candidate, null);
  assert.equal(unverified.actionable, true);
  assert.equal(unverified.latestAttempt.id, 'weekly-a');
  const historical = result.entries.find((entry) => entry.kind === 'review_candidate');
  assert.equal(historical.actionable, false);
  assert.deepEqual(historical.candidate.staleReasons, ['newer_attempt']);
});
