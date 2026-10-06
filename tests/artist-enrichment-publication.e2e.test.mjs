import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { validateDisposableDatabase } from '../scripts/prepare-cutover-test-db.mjs';

const databaseUrl = process.env.ARTIST_ENRICHMENT_TEST_DATABASE_URL;
if (databaseUrl) validateDisposableDatabase(databaseUrl);

test('disposable PostgreSQL: changed/unchanged, rollback, fencing, restart and review', { skip: !databaseUrl }, async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { claimOperationalState } = await import('../lib/catalog/operational-state.ts');
  const { publishArtistEnrichment } = await import('../lib/catalog/artist-enrichment-publication.ts');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID();
  const slug = `enrichment-test-${suffix}`;
  const name = `Synthetic ${suffix}`;
  const id = randomUUID();
  const url = `https://musicbrainz.org/artist/${id}`;
  const checkedAt = '2026-10-01';
  const payload = {
    cache: { [slug]: { count: 1, artists: [{ id, name, area: { name: 'Synthetic origin' }, tags: [{ name: 'synthetic', count: 1 }] }] } },
    result: { schemaVersion: 1, source: 'musicbrainz', generatedAt: '2026-10-02T00:00:00.000Z',
      profiles: { [slug]: { identities: { musicbrainz: id, setlistFm: id }, origin: 'Synthetic origin', genres: ['synthetic'], links: [],
        provenance: ['identity', 'origin', 'genres'].map((field) => ({ field, source: 'musicbrainz', url, checkedAt })) } }, manualReview: [] },
    nextRunAt: '2099-01-01T00:00:00.000Z',
  };
  let lease;
  let triggerInstalled = false;
  let functionInstalled = false;
  try {
    // Test database must be dedicated: never replace another worker's state.
    assert.equal(await db.operationalState.count({ where: { key: 'artist-enrichment' } }), 0, 'Use a fresh dedicated disposable database');
    await db.artist.create({ data: { slug, name, aliases: [], genres: [], topTracks: [], recentSetlists: [], freshness: {}, identityState: 'UNRESOLVED' } });
    lease = await claimOperationalState(db, 'artist-enrichment');
    await lease.save(payload);
    // Force a failure at the receipt write after all canonical writes. PostgreSQL
    // must roll back both artist rows and audit, leaving the result retryable.
    await db.$executeRawUnsafe(`CREATE FUNCTION enrichment_test_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.key = 'artist-enrichment' AND NEW.payload ? 'publication' THEN
      RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$`);
    functionInstalled = true;
    await db.$executeRawUnsafe(`CREATE TRIGGER enrichment_test_reject_receipt BEFORE UPDATE ON "OperationalState"
      FOR EACH ROW EXECUTE FUNCTION enrichment_test_reject_receipt()`);
    triggerInstalled = true;
    const auditCount = await db.adminAuditEntry.count({ where: { action: 'ARTIST_ENRICHMENT_PUBLICATION' } });
    await assert.rejects(publishArtistEnrichment(db, lease), /synthetic receipt failure/);
    assert.equal(await db.artistIdentity.count({ where: { artist: { slug } } }), 0);
    assert.equal(await db.artistProvenance.count({ where: { artist: { slug } } }), 0);
    assert.equal((await db.artist.findUniqueOrThrow({ where: { slug } })).origin, null);
    assert.equal(await db.adminAuditEntry.count({ where: { action: 'ARTIST_ENRICHMENT_PUBLICATION' } }), auditCount);
    await db.$executeRawUnsafe('DROP TRIGGER enrichment_test_reject_receipt ON "OperationalState"');
    triggerInstalled = false;
    await db.$executeRawUnsafe('DROP FUNCTION enrichment_test_reject_receipt()');
    functionInstalled = false;
    // Crash after durable result, before publication; a separate Node process retries.
    await lease.release();
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import { PrismaClient } from '@prisma/client';
      import { claimOperationalState } from './lib/catalog/operational-state.ts';
      import { publishArtistEnrichment } from './lib/catalog/artist-enrichment-publication.ts';
      const db = new PrismaClient(); let lease;
      try { lease = await claimOperationalState(db, 'artist-enrichment'); console.log(JSON.stringify(await publishArtistEnrichment(db, lease))); }
      finally { await lease?.release(); await db.$disconnect(); }
    `], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' });
    assert.equal((await db.operationalState.findUniqueOrThrow({ where: { key: 'artist-enrichment' } })).payload.publication.changed, 3);
    const snapshot = await db.artist.findUniqueOrThrow({ where: { slug }, include: { identities: true, provenance: true, links: true } });
    assert.equal(snapshot.identities.length, 1);
    assert.equal(snapshot.identityState, 'UNRESOLVED');
    lease = await claimOperationalState(db, 'artist-enrichment');
    assert.equal((await publishArtistEnrichment(db, lease)).changed, 0);
    assert.deepEqual(await db.artist.findUniqueOrThrow({ where: { slug }, include: { identities: true, provenance: true, links: true } }), snapshot);
    payload.result.generatedAt = '2026-10-03T00:00:00.000Z';
    payload.cache[slug].artists[0].area.name = 'Changed provider origin';
    payload.result.profiles[slug].origin = 'Changed provider origin';
    await lease.save(payload);
    const protectedResult = await publishArtistEnrichment(db, lease);
    assert.equal(protectedResult.changed, 0);
    assert.ok(protectedResult.reviews.some((r) => r.field === 'origin' && r.reason === 'protected_field'));
    assert.deepEqual(await db.artist.findUniqueOrThrow({ where: { slug }, include: { identities: true, provenance: true, links: true } }), snapshot);
    // Expired/reclaimed workers cannot acknowledge even an already published result.
    await db.operationalState.update({ where: { key: lease.key }, data: { leaseExpiresAt: new Date('2020-01-01') } });
    await assert.rejects(publishArtistEnrichment(db, lease), /lease lost/);
    const newLease = await claimOperationalState(db, 'artist-enrichment');
    await assert.rejects(publishArtistEnrichment(db, lease), /lease lost/);
    lease = newLease;
    // A new result never overwrites existing values; ambiguity stays in durable review.
    payload.result.generatedAt = '2026-10-04T00:00:00.000Z';
    payload.cache[slug].artists.push({ id: randomUUID(), name });
    payload.cache[slug].count = 2;
    await lease.save(payload);
    const ambiguous = await publishArtistEnrichment(db, lease);
    assert.equal(ambiguous.changed, 0);
    assert.equal(ambiguous.reviews[0].reason, 'multiple_exact_matches');
    assert.deepEqual(await db.artist.findUniqueOrThrow({ where: { slug }, include: { identities: true, provenance: true, links: true } }), snapshot);
    // Invalid top-level input produces no receipt and no writes.
    payload.result.schemaVersion = 2;
    await lease.save(payload);
    await assert.rejects(publishArtistEnrichment(db, lease), /invalid_persisted_evidence/);
    assert.equal((await db.operationalState.findUniqueOrThrow({ where: { key: lease.key } })).payload.publication, undefined);
  } finally {
    if (triggerInstalled) await db.$executeRawUnsafe('DROP TRIGGER enrichment_test_reject_receipt ON "OperationalState"');
    if (functionInstalled) await db.$executeRawUnsafe('DROP FUNCTION enrichment_test_reject_receipt()');
    await lease?.release();
    await db.artist.deleteMany({ where: { slug } });
    await db.operationalState.deleteMany({ where: { key: 'artist-enrichment', payload: { path: ['result', 'profiles', slug, 'identities', 'musicbrainz'], equals: id } } });
    // Audit is append-only; this dedicated disposable database is destroyed by the test harness.
    await db.$disconnect();
  }
});
