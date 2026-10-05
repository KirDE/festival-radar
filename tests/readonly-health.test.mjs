import assert from 'node:assert/strict';
import test from 'node:test';
import { readonlyDueHealth, readonlyHealthAlert, validateReadonlyHealthCounts } from '../lib/ingestion/readonly-health.ts';

const now = new Date('2026-10-01T09:00:00Z');
const old = new Date('2026-10-01T08:00:00Z');
const future = new Date('2026-10-01T10:00:00Z');
const privateText = 'private-secret-marker';
const parserRows = [
  { festivalSlug: 'fixture', strategies: ['manual_review'], parserKey: 'manual_review', _count: { _all: 2 } },
  { festivalSlug: privateText, strategies: ['manual_review'], parserKey: privateText, _count: { _all: 3 } },
  { festivalSlug: 'fixture', strategies: ['manual_review'], parserKey: null, _count: { _all: 1 } },
  { festivalSlug: 'fixture', strategies: ['json_ld_event'], parserKey: 'manual_review', _count: { _all: 1 } },
  { festivalSlug: privateText, strategies: ['official_markup'], parserKey: 'official_markup:wacken', _count: { _all: 1 } },
];

function matches(row, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some(part => matches(row, part));
    if (key === 'AND') return condition.every(part => matches(row, part));
    const value = row[key];
    if (!condition || typeof condition !== 'object') return value === condition;
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === 'not') return value !== expected;
      if (operator === 'in') return expected.includes(value);
      if (operator === 'gt') return value !== null && value > expected;
      if (operator === 'lte') return value !== null && value <= expected;
      assert.fail('Unexpected read predicate');
    });
  });
}

function fixture() {
  const source = { enabled: true, configurationBackfilledAt: old, festivalId: 'private-id', editionId: 'private-id',
    parserKey: 'manual_review', cadenceSeconds: 3600, nextRunAt: old, leaseOwner: null, leaseExpiresAt: null, consecutiveFailures: 0 };
  const sources = [source, { ...source, leaseOwner: 'private-owner', leaseExpiresAt: future },
    { ...source, leaseOwner: 'private-owner', leaseExpiresAt: now, consecutiveFailures: 1 },
    { ...source, nextRunAt: null }, { ...source, enabled: false }, { ...source, configurationBackfilledAt: null }];
  const playlist = (status, changes = {}) => ({ status, requestedAt: old, leaseOwner: null, leaseExpiresAt: null, retryAt: null,
    id: privateText, lastError: privateText, ...changes });
  const playlists = [playlist('PENDING'), playlist('PENDING', { requestedAt: future }),
    playlist('RUNNING', { leaseOwner: 'private-owner', leaseExpiresAt: future }),
    playlist('RUNNING', { leaseOwner: 'private-owner', leaseExpiresAt: now }), playlist('RUNNING'),
    playlist('RUNNING', { leaseOwner: 'private-owner' }), playlist('RUNNING', { leaseExpiresAt: future }),
    playlist('FAILED', { retryAt: now }), playlist('FAILED', { retryAt: future }), playlist('FAILED'), playlist('SUCCEEDED')];
  const outbox = [{ deliveredAt: null, createdAt: old }, { deliveredAt: null, createdAt: future }, { deliveredAt: now, createdAt: old }];
  const queries = [];
  const delegate = (name, rows) => ({ count: async query => {
    queries.push([name, query]);
    return rows.filter(row => matches(row, query.where)).length;
  } });
  const db = {
    festivalSource: { ...delegate('source', sources), groupBy: async query => { queries.push(['parser', query]); return structuredClone(parserRows); } },
    ingestionNotificationOutbox: delegate('outbox', outbox),
    catalogPlaylistRefresh: delegate('playlist', playlists),
  };
  return { db, queries, sources, playlists, outbox };
}

test('read-only diagnostic reuses due/errors/outbox/parser health and counts all playlist states and lag', async () => {
  const { db, queries, sources, playlists, outbox } = fixture();
  const before = structuredClone({ sources, playlists, outbox });
  const result = await readonlyDueHealth(db, now);
  assert.deepEqual(result, {
    due: 3, queueLaggedOverHour: 2, active: 1, expired: 1, error: 1,
    outboxPending: 2, outboxLaggedOverHour: 1, unknownParserKeys: 6,
    playlistPending: 2, playlistRunning: 5, playlistSucceeded: 1, playlistFailed: 3,
    playlistLaggedOverHour: 9, playlistExpired: 1, playlistUnleasedRunning: 3,
    playlistRetryDue: 1, playlistDormantFailed: 1,
  });
  assert.equal(queries.length, 17);
  assert.deepEqual({ sources, playlists, outbox }, before);
  assert.ok(Object.values(result).every(value => Number.isSafeInteger(value) && value >= 0));
  assert.doesNotMatch(JSON.stringify(result), /private|secret|token|manual_review|wacken/);
});

async function zeroCounts() {
  const { db } = fixture();
  const counts = await readonlyDueHealth(db, now);
  return Object.fromEntries(Object.keys(counts).map(key => [key, 0]));
}

const assertSafeFailure = async promise => assert.rejects(promise, error => {
  assert.equal(error.message, 'Read-only health unavailable');
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(String(error), /private|secret|token/);
  return true;
});

test('fixed decision thresholds are inclusive, deterministic and count-only', async () => {
  const zero = await zeroCounts();
  const alertFields = ['queueLaggedOverHour', 'expired', 'error', 'outboxLaggedOverHour', 'unknownParserKeys',
    'playlistLaggedOverHour', 'playlistExpired', 'playlistUnleasedRunning', 'playlistFailed'];
  assert.equal(readonlyHealthAlert(zero), 0);
  for (const field of Object.keys(zero)) {
    const input = { ...zero, [field]: Number.MAX_SAFE_INTEGER };
    assert.equal(readonlyHealthAlert(input), alertFields.includes(field) ? 1 : 0);
    assert.equal(readonlyHealthAlert({ ...zero, [field]: 1 }), alertFields.includes(field) ? 1 : 0);
    assert.equal(input[field], Number.MAX_SAFE_INTEGER);
  }
});

test('exact schema rejects bad counts and hostile extra input without serialization or getters', async () => {
  const zero = await zeroCounts();
  for (const field of Object.keys(zero)) {
    for (const bad of [-1, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', privateText, null, undefined, 1n, true, {}]) {
      for (const fn of [validateReadonlyHealthCounts, readonlyHealthAlert]) {
        assert.throws(() => fn({ ...zero, [field]: bad }), { message: 'Read-only health unavailable' });
      }
    }
  }
  const missing = { ...zero }; delete missing.due;
  const getter = { ...zero }; Object.defineProperty(getter, 'due', { enumerable: true, get() { assert.fail('getter called'); } });
  for (const input of [null, [], privateText, missing, getter, { ...zero, url: privateText },
    { ...zero, [Symbol(privateText)]: 1 }, { ...zero, toJSON() { assert.fail('serialized'); } }, Object.create(zero)]) {
    assert.throws(() => readonlyHealthAlert(input), { message: 'Read-only health unavailable' });
  }
  assert.deepEqual(validateReadonlyHealthCounts(zero), zero);
  assert.notEqual(validateReadonlyHealthCounts(zero), zero);
});

test('malformed clock fails before reads', async () => {
  const db = new Proxy({}, { get() { assert.fail('database accessed'); } });
  for (const clock of [null, undefined, '2026-10-01', {}, new Date(NaN), new Date(-8.64e15)]) {
    await assertSafeFailure(readonlyDueHealth(db, clock));
  }
});

test('DB errors and malformed counts fail closed across every delegate, including valid parser groups', async () => {
  for (const [delegate, method] of [['festivalSource', 'count'], ['festivalSource', 'groupBy'],
    ['ingestionNotificationOutbox', 'count'], ['catalogPlaylistRefresh', 'count']]) {
    const { db } = fixture();
    db[delegate][method] = async () => { throw new Error(privateText); };
    await assertSafeFailure(readonlyDueHealth(db, now));
  }
  for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, privateText, null]) {
    for (const delegate of ['festivalSource', 'ingestionNotificationOutbox', 'catalogPlaylistRefresh']) {
      const { db } = fixture(); db[delegate].count = async () => bad;
      await assertSafeFailure(readonlyDueHealth(db, now));
    }
    for (const index of [0, 1]) {
      const { db } = fixture();
      db.festivalSource.groupBy = async () => parserRows.map((row, i) => i === index ? { ...row, _count: { _all: bad } } : row);
      await assertSafeFailure(readonlyDueHealth(db, now));
    }
  }
  for (const rows of [null, {}, [{}], [{ ...parserRows[0], _count: null }],
    [1, 1].map(() => ({ ...parserRows[1], _count: { _all: Number.MAX_SAFE_INTEGER } }))]) {
    const { db } = fixture(); db.festivalSource.groupBy = async () => rows;
    await assertSafeFailure(readonlyDueHealth(db, now));
  }
});
