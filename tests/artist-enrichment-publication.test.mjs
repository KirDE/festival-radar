import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishArtistEnrichment, validateEnrichmentProfile } from '../lib/catalog/artist-enrichment-publication.ts';
import { migrateEnrichmentState } from '../lib/catalog/artist-enrichment-state.ts';
import { runEnrichment } from '../scripts/enrich-artists.mjs';

test('symlinked release entrypoint runs instead of silently exiting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'festival-enrichment-entry-'));
  try {
    const link = join(dir, 'enrich-artists.mjs');
    symlinkSync(fileURLToPath(new URL('../scripts/enrich-artists.mjs', import.meta.url)), link);
    const run = spawnSync(process.execPath, ['--experimental-strip-types', link], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' }, timeout: 10_000,
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /Artist enrichment failed; durable progress retained/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const url = `https://musicbrainz.org/artist/${id}`;
const proof = (field) => ({ field, source: 'musicbrainz', url, checkedAt: '2026-10-01' });
export function fixture() {
  const profile = { identities: { musicbrainz: id, setlistFm: id }, origin: 'Germany', genres: ['metal'],
    links: [{ label: 'Official site', url: 'https://synthetic.example/', source: 'official', verified: true }],
    provenance: ['identity', 'origin', 'genres'].map(proof) };
  const search = { count: 1, artists: [{ id, name: 'Synthetic Artist', area: { name: 'Germany' },
    tags: [{ name: 'metal', count: 2 }], relations: [{ type: 'official homepage', url: { resource: 'https://synthetic.example/' } }] }] };
  const artist = { id: 'canonical', slug: 'synthetic', name: 'Synthetic Artist', aliases: [], genres: [], origin: null,
    identityState: 'UNRESOLVED', identities: [], provenance: [], links: [] };
  return { profile, search, artist, payload: { cache: { synthetic: search }, result: { schemaVersion: 1, source: 'musicbrainz',
    generatedAt: '2026-10-02T00:00:00.000Z', profiles: { synthetic: profile }, manualReview: [] }, nextRunAt: '2099-01-01T00:00:00.000Z' } };
}
function database(f = fixture()) {
  let state = structuredClone({ payload: f.payload, artists: [f.artist], adminValues: {}, decisions: [], audits: [], lease: true, finalLease: true });
  const db = { get state() { return state; },
    async $transaction(fn, options) {
      assert.equal(options.isolationLevel, 'Serializable');
      const snapshot = structuredClone(state);
      const artist = () => state.artists[0];
      try { return await fn({
        $queryRaw: async () => state.lease ? [{ payload: structuredClone(state.payload) }] : [],
        $executeRaw: async (_sql, payload) => { if (!state.finalLease) return 0; state.payload = JSON.parse(payload); return 1; },
        artist: { findMany: async () => structuredClone(state.artists), findUnique: async ({ where }) => structuredClone(state.artists.find((a) => a.slug === where.slug) ?? null), update: async ({ data }) => Object.assign(artist(), data) },
        artistIdentity: {
          findUnique: async ({ where }) => state.artists.flatMap((a) => a.identities).find((i) => i.provider === where.provider_externalId.provider && i.externalId === where.provider_externalId.externalId) ?? null,
          create: async ({ data }) => artist().identities.push(data),
        },
        artistLink: { create: async ({ data }) => artist().links.push(data) },
        artistProvenance: { create: async ({ data }) => artist().provenance.push(data) },
        adminResourceState: { findUnique: async () => ({ values: state.adminValues }) },
        adminChange: { findMany: async () => state.decisions },
        adminAuditEntry: { create: async ({ data }) => state.audits.push(data) },
      }); } catch (error) { state = snapshot; throw error; }
    },
  };
  return db;
}
const lease = { key: 'artist-enrichment', owner: 'test-owner' };

test('validates exact persisted evidence, preserving punctuation and accents', () => {
  const { profile, search } = fixture();
  assert.equal(validateEnrichmentProfile('SYNTHETIC ARTIST', profile, search).url, url);
  for (const name of ['Synthetic-Artist', 'Synthetic Artíst', 'Other']) assert.throws(() => validateEnrichmentProfile(name, profile, search), /no_exact_match/);
  search.artists.push({ ...search.artists[0], id: otherId });
  search.count = 2;
  assert.throws(() => validateEnrichmentProfile('Synthetic Artist', profile, search), /multiple_exact_matches/);
});
test('rejects truncated search, changed identity, tampered values and missing evidence', () => {
  for (const mutate of [
    (f) => { f.search.count = 11; }, (f) => { f.profile.identities.musicbrainz = otherId; },
    (f) => { delete f.search.count; },
    (f) => { f.profile.origin = 'France'; }, (f) => { f.profile.genres = ['pop']; },
    (f) => { f.profile.links[0].url = 'https://unproven.example/'; },
    (f) => { f.profile.links.push({ ...f.profile.links[0] }); },
    (f) => { f.profile.provenance = [proof('identity')]; },
    (f) => { f.profile.provenance[0].checkedAt = '2026-02-30'; },
    (f) => { f.profile.provenance[0].source = 'official'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => validateEnrichmentProfile(f.artist.name, f.profile, f.search));
  }
});
test('fills only bounded fields with provenance and an atomic receipt; repeat and new process change zero', async () => {
  const db = database();
  const result = await publishArtistEnrichment(db, lease);
  assert.equal(result.changed, 4);
  assert.deepEqual(result.reviews, []);
  const a = db.state.artists[0];
  assert.equal(a.identities.length, 1); // No inferred setlist.fm identity.
  assert.equal(a.identityState, 'UNRESOLVED');
  assert.equal(a.links[0].source, 'musicbrainz'); assert.equal(a.links[0].verified, false);
  assert.deepEqual(a.provenance.map((p) => p.field), ['identity', 'origin', 'genres', 'links']);
  const snapshot = structuredClone(db.state);
  assert.equal((await publishArtistEnrichment(db, lease)).changed, 0);
  assert.deepEqual(db.state, snapshot);
  const restarted = database(); Object.assign(restarted.state, snapshot);
  assert.equal((await publishArtistEnrichment(restarted, lease)).changed, 0);
  // A newly generated result still preserves existing rows and their provenance.
  restarted.state.payload.result.generatedAt = '2026-10-03T00:00:00.000Z';
  assert.equal((await publishArtistEnrichment(restarted, lease)).changed, 0);
  assert.deepEqual(restarted.state.artists, snapshot.artists);
});
test('protects nonempty values, provenance on empty fields and manual/admin intent', async () => {
  const db = database();
  db.state.artists[0].origin = 'Reviewed origin';
  db.state.artists[0].provenance = [{ ...proof('genres'), position: 10 }];
  db.state.adminValues = { links: [] };
  const result = await publishArtistEnrichment(db, lease);
  assert.equal(result.changed, 1);
  assert.deepEqual(result.reviews.map((r) => r.field), ['origin', 'genres', 'links']);
  assert.equal(db.state.artists[0].origin, 'Reviewed origin');
  assert.deepEqual(db.state.artists[0].genres, []);
  assert.deepEqual(db.state.artists[0].links, []);
  const protectedIdentity = database(); protectedIdentity.state.decisions = [{ field: 'identities' }];
  assert.equal((await publishArtistEnrichment(protectedIdentity, lease)).changed, 0);
});
test('persists ambiguity and identity conflicts without canonical changes', async () => {
  for (const mutate of [
    (db) => db.state.artists.push({ ...db.state.artists[0], id: 'duplicate', slug: 'different-slug' }),
    (db) => { db.state.artists[0].identityState = 'AMBIGUOUS'; },
    (db) => { db.state.artists[0].identityState = 'LINKED'; },
    (db) => { db.state.artists[0].identities = [{ provider: 'musicbrainz', externalId: otherId, artistId: 'canonical' }]; },
    (db) => db.state.artists.push({ ...db.state.artists[0], id: 'other', slug: 'other', name: 'Other', identities: [{ provider: 'musicbrainz', externalId: id, artistId: 'other' }] }),
    (db) => { delete db.state.payload.cache.synthetic; },
    (db) => { db.state.payload.result.manualReview = [{ slug: 'synthetic', name: 'Synthetic Artist', reason: 'multiple_exact_matches' }]; },
  ]) {
    const db = database(); mutate(db); const before = structuredClone(db.state.artists);
    const result = await publishArtistEnrichment(db, lease);
    assert.equal(result.changed, 0); assert.ok(result.reviews.length);
    assert.deepEqual(db.state.artists, before);
    assert.deepEqual(db.state.payload.publication.reviews, result.reviews);
  }
});
test('expired/reclaimed lease fails before writes; expiry during commit rolls back everything', async () => {
  for (const field of ['lease', 'finalLease']) {
    const db = database(); db.state[field] = false; const before = structuredClone(db.state);
    await assert.rejects(publishArtistEnrichment(db, lease), /lease lost/);
    assert.deepEqual(db.state, before);
  }
});
test('bad result version and oversized batch fail closed', async () => {
  const db = database(); db.state.payload.result.schemaVersion = 2;
  await assert.rejects(publishArtistEnrichment(db, lease), /invalid_persisted_evidence/);
  const big = database(); const p = big.state.payload.result.profiles.synthetic;
  big.state.payload.result.profiles = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`slug-${i}`, p]));
  await assert.rejects(publishArtistEnrichment(big, lease), /bound/);
  const bytes = database(); bytes.state.payload.cache.unused = 'x'.repeat(10_000_001);
  await assert.rejects(publishArtistEnrichment(bytes, lease), /byte bound/);
});
test('worker retries before schedule gate and publishes only after persisting complete result', async () => {
  const source = await readFile(new URL('../scripts/enrich-artists.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('await publishArtistEnrichment(db, store)') < source.indexOf('if (store.payload?.nextRunAt'));
  assert.ok(source.lastIndexOf('await publishArtistEnrichment(db, store)') > source.indexOf('await store.save({ cache, result,'));
  assert.doesNotMatch(source, /writeFile|rename/);
});

test('flat import is retained exactly, audited without search and stable on restart', async () => {
  const db = database();
  const flat = structuredClone(db.state.payload.result);
  flat.manualReview.push({ slug: 'review-only', name: 'Other', reason: 'multiple_exact_matches', candidateIds: [id, otherId] });
  db.state.payload = flat;
  const before = structuredClone(db.state.artists);
  const publication = await publishArtistEnrichment(db, lease);
  assert.equal(publication.changed, 0);
  assert.ok(publication.reviews.some((r) => r.slug === 'synthetic' && r.reason === 'missing_provider_search'));
  assert.ok(publication.reviews.some((r) => r.slug === 'review-only' && r.reason === 'multiple_exact_matches'));
  assert.deepEqual(db.state.payload.legacyImport.evidence, flat);
  assert.deepEqual(db.state.audits[0].evidence.legacyImport.evidence, flat);
  assert.deepEqual(db.state.artists, before);
  const snapshot = structuredClone(db.state);
  assert.equal((await publishArtistEnrichment(db, lease)).changed, 0);
  assert.deepEqual(db.state, snapshot);
  // Simulate JSONB key ordering across database/process boundaries.
  const reorder = (v) => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, item]) => [k, reorder(item)])) : v;
  assert.doesNotThrow(() => migrateEnrichmentState(reorder(db.state.payload)));
  db.state.payload.legacyImport.evidence.profiles.synthetic.origin = 'Changed';
  await assert.rejects(publishArtistEnrichment(db, lease), /integrity_mismatch/);
});

test('receipt is invalidated by changed, absent, truncated or ambiguous search evidence', async () => {
  for (const mutate of [
    (p) => { delete p.cache; },
    (p) => { delete p.cache.synthetic.count; },
    (p) => { p.cache.synthetic.count = 10; },
    (p) => { p.cache.synthetic.artists.push({ id: otherId, name: 'Synthetic Artist' }); p.cache.synthetic.count = 2; },
  ]) {
    const db = database();
    await publishArtistEnrichment(db, lease);
    mutate(db.state.payload);
    const before = structuredClone(db.state.artists);
    const receipt = await publishArtistEnrichment(db, lease);
    assert.equal(receipt.changed, 0);
    assert.ok(receipt.reviews.length);
    assert.equal(receipt.repeated, undefined);
    assert.deepEqual(db.state.artists, before);
  }
});

function workerOptions(db, fetchSearch, saveHook) {
  return { db, store: { ...lease, payload: structuredClone(db.state.payload),
    async save(payload) {
      db.state.payload = JSON.parse(JSON.stringify(payload));
      await saveHook?.(db.state.payload);
    } }, readArtists: async () => db.state.artists.map(({ slug, name }) => ({ slug, name })),
    fetchSearch, pause: async () => {}, now: () => new Date('2026-10-06T00:00:00.000Z') };
}

test('failed fetch preserves flat import and reviews, checkpoints failure, bypasses gate and retries', async () => {
  const db = database();
  const flat = structuredClone(db.state.payload.result);
  flat.manualReview.push({ slug: 'review-only', name: 'Other', reason: 'no_exact_match' });
  db.state.payload = flat;
  const failed = await runEnrichment(workerOptions(db, async () => { throw new Error('fetch https://user:password@example.test failed'); }));
  assert.equal(failed.complete, false);
  assert.equal(db.state.payload.nextRunAt, null);
  assert.deepEqual(db.state.payload.result.profiles, flat.profiles);
  assert.deepEqual(db.state.payload.legacyImport.evidence, flat);
  assert.ok(db.state.payload.result.manualReview.some((r) => r.reason === 'source_unavailable'));
  assert.doesNotMatch(JSON.stringify(db.state), /password|user:/);
  assert.equal(db.state.artists[0].identities.length, 0);
  // A stale scheduler value cannot delay incomplete work.
  db.state.payload.nextRunAt = '2099-01-01T00:00:00.000Z';
  let requests = 0;
  const retried = await runEnrichment(workerOptions(db, async () => { requests++; return fixture().search; }));
  assert.equal(retried.complete, true);
  assert.equal(requests, 1);
  assert.equal(db.state.artists[0].identities.length, 1);
  assert.deepEqual(db.state.payload.legacyImport.evidence, flat);
  const snapshot = structuredClone(db.state);
  await runEnrichment(workerOptions(db, async () => { throw new Error('must not fetch on idempotent restart'); }));
  assert.deepEqual(db.state, snapshot);
});

test('reentry after search checkpoint consumes durable evidence without refetch', async () => {
  const db = database(); db.state.payload = {};
  let requests = 0;
  let crash = true;
  await assert.rejects(runEnrichment(workerOptions(db, async () => { requests++; return fixture().search; }, (p) => {
    if (crash && p.cache?.synthetic && !p.work.completed.length) { crash = false; throw new Error('synthetic process interruption'); }
  })), /interruption/);
  assert.equal(db.state.payload.work.complete, false);
  assert.equal(db.state.payload.nextRunAt, null);
  assert.ok(db.state.payload.cache.synthetic);
  const result = await runEnrichment(workerOptions(db, async () => { requests++; throw new Error('unexpected fetch'); }));
  assert.equal(requests, 1);
  assert.equal(result.complete, true);
  assert.equal(db.state.artists[0].identities.length, 1);
});

test('completed progress survives failure of a later artist and only unfinished work retries', async () => {
  const db = database(); db.state.payload = {};
  db.state.artists.push({ ...fixture().artist, id: 'other', slug: 'other', name: 'Other' });
  await runEnrichment(workerOptions(db, async (name) => {
    if (name === 'Other') throw new Error('network failed');
    return fixture().search;
  }));
  assert.deepEqual(db.state.payload.work.completed, ['synthetic']);
  assert.ok(db.state.payload.result.profiles.synthetic);
  const names = [];
  await runEnrichment(workerOptions(db, async (name) => { names.push(name); return { count: 0, artists: [] }; }));
  assert.deepEqual(names, ['Other']);
  assert.equal(db.state.payload.work.complete, true);
  assert.equal(db.state.artists[0].identities.length, 1);
});

test('restart after final checkpoint publishes before daily gate without another fetch', async () => {
  const db = database(); db.state.payload = {};
  await assert.rejects(runEnrichment(workerOptions(db, async () => fixture().search, (p) => {
    if (p.work.complete) throw new Error('crash before publication');
  })), /crash before publication/);
  assert.equal(db.state.artists[0].identities.length, 0);
  assert.equal(db.state.payload.work.complete, true);
  assert.ok(db.state.payload.nextRunAt);
  await runEnrichment(workerOptions(db, async () => { throw new Error('must not fetch'); }));
  assert.equal(db.state.artists[0].identities.length, 1);
  const snapshot = structuredClone(db.state);
  await runEnrichment(workerOptions(db, async () => { throw new Error('must not fetch'); }));
  assert.deepEqual(db.state, snapshot);
});

test('a legacy result without cache bypasses its daily gate and obtains provider evidence', async () => {
  const db = database(); delete db.state.payload.cache;
  let requests = 0;
  await runEnrichment(workerOptions(db, async () => { requests++; return fixture().search; }));
  assert.equal(requests, 1);
  assert.equal(db.state.artists[0].identities.length, 1);
  assert.ok(db.state.audits[0].metadata.reviews.some((r) => r.reason === 'missing_provider_search'));
});

test('unsafe and oversized legacy evidence fails closed without writes', async () => {
  for (const mutate of [
    (flat) => { flat.manualReview = [{ slug: 'other', name: 'Other', reason: 'fetch https://user:password@example.test failed' }]; },
    (flat) => { flat.profiles.synthetic.links[0].url = 'https://user:password@example.test'; },
    (flat) => { flat.manualReview = Array(1001).fill({ slug: 'other', name: 'Other', reason: 'no_exact_match' }); },
  ]) {
    const db = database(); db.state.payload = structuredClone(db.state.payload.result); mutate(db.state.payload);
    const snapshot = structuredClone(db.state);
    await assert.rejects(publishArtistEnrichment(db, lease), /Unsafe|bound/);
    assert.deepEqual(db.state, snapshot);
  }
});
