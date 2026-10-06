import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { claimPlaylistRefresh, finishPlaylistRefresh, spotifyCreationState, stagePlaylistPlan, PlaylistLeaseLostError } from '../lib/catalog/playlist-queue.ts';
import { runPlaylistWorker } from '../lib/catalog/playlist-worker.ts';

// Explicit opt-in only; never fall through to an application's DATABASE_URL.
const url = process.env.PLAYLIST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !/(?:test|integration)/i.test(parsed.pathname)
    || parsed.searchParams.has('host') || parsed.searchParams.has('hostaddr')) throw new Error('Disposable local playlist test DB required');
}

test('creation intent survives reclaim and newer publications; worker publishes only verified ID', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const slug = `creation-test-${randomUUID()}`;
  try {
    const festival = await db.festival.create({ data: {
      slug, name: 'Synthetic festival', country: 'Test', countryCode: 'DE', genres: [], officialUrl: 'https://example.test/',
      editions: { create: { year: 2027, startDate: new Date('2027-06-01'), endDate: new Date('2027-06-02'), status: 'TBA', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'TBA', sourceUpdatedAt: new Date('2026-01-01') } },
    }, include: { editions: true } });
    const publish = async (offset: number) => {
      const publication = await db.catalogPublication.create({ data: {
        source: 'INGESTION', sourceId: `creation:${randomUUID()}`, festivalSlug: slug, editionYear: 2027,
        actorLabel: 'test', fields: ['lineup'], lineupChanged: true, createdAt: new Date(Date.UTC(2027, 0, 1, 0, 0, offset)),
      } });
      await db.catalogPlaylistRefresh.create({ data: { publicationId: publication.id, festivalSlug: slug, requestedAt: new Date(Date.UTC(2000, 0, 1, 0, 0, offset)) } });
      return publication;
    };
    const original = await publish(0);
    const claimed = await claimPlaylistRefresh(db, { owner: randomUUID(), ttlMs: 120_000 });
    assert.ok(claimed.claim);
    const claim = claimed.claim;
    assert.equal(claim.publicationId, original.id);
    const plan = { playlist_url: '', edition_year: 2027, track_uris: ['spotify:track:' + 'b'.repeat(22)] };
    assert.deepEqual(await stagePlaylistPlan(db, claim, plan), plan);
    assert.deepEqual(await stagePlaylistPlan(db, claim, { other: 'must not replace durable plan' }), plan);
    const intent = await spotifyCreationState(db, claim, 'reserve', '');
    assert.equal(intent.sent, true);
    await assert.rejects(spotifyCreationState(db, claim, 'reserve', ''), /already sent/);
    await db.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${claim.id}`;
    await assert.rejects(spotifyCreationState(db, claim, 'bind', '', 'a'.repeat(22)), PlaylistLeaseLostError);
    const reclaimed = (await claimPlaylistRefresh(db, { owner: randomUUID(), ttlMs: 120_000 })).claim;
    assert.ok(reclaimed);
    assert.equal(reclaimed.attempts, claim.attempts + 1);
    assert.deepEqual(await spotifyCreationState(db, reclaimed, 'read', ''), intent);
    await spotifyCreationState(db, reclaimed, 'bind', '', 'a'.repeat(22));
    await finishPlaylistRefresh(db, reclaimed, 'FAILED');

    const newer = await publish(1);
    const result = await runPlaylistWorker(db, async (active, guard) => {
      assert.equal(active.publicationId, newer.id);
      await guard();
      const recovered = await spotifyCreationState(db, active, 'read', '');
      assert.equal(recovered.marker, intent.marker);
      assert.equal(recovered.playlistId, 'a'.repeat(22));
      await assert.rejects(spotifyCreationState(db, active, 'reserve', ''), /already sent/);
      await spotifyCreationState(db, active, 'bind', '', recovered.playlistId!);
      return { url: 'https://open.spotify.com/playlist/' + recovered.playlistId, expectedUrl: '', artists: 1, tracks: 1 };
    });
    assert.equal(result.status, 'SUCCEEDED');
    const binding = await db.festivalPlaylist.findUniqueOrThrow({ where: { editionId_provider: { editionId: festival.editions[0].id, provider: 'spotify' } } });
    assert.equal(binding.url, 'https://open.spotify.com/playlist/' + 'a'.repeat(22));
    assert.equal(binding.trackCount, 1);
    assert.ok(binding.syncedAt);
  } finally {
    // Queue history/publications remain append-only in this disposable DB.
    await db.catalogPlaylistRefresh.updateMany({ where: { festivalSlug: slug }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseExpiresAt: null } });
    await db.festival.deleteMany({ where: { slug } });
    await db.$disconnect();
  }
});
