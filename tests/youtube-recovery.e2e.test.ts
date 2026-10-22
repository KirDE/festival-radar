import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { claimPlaylistRefresh, finishPlaylistRefresh, PlaylistLeaseLostError } from '../lib/catalog/playlist-queue.ts';
import { stageYoutubePlan, youtubeProviderState } from '../lib/catalog/youtube-playlist-queue.ts';

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
test.after(async () => { await db.$disconnect(); });

test('real PostgreSQL legacy adoption, exact rejected-write recovery and expired-lease fencing', async () => {
  const slug = 'youtube-recovery-' + randomUUID();
  const festival = await db.festival.create({ data: { slug, name: 'Synthetic', country: 'Test', countryCode: 'DE', genres: [], officialUrl: 'https://example.test/', editions: { create: { year: 2027, status: 'PARTIAL', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'PARTIAL', sourceUpdatedAt: new Date() } } } });
  const publication = await db.catalogPublication.create({ data: { source: 'ADMIN', sourceId: slug, festivalSlug: slug, editionYear: 2027, actorLabel: 'test', fields: ['lineup'], lineupChanged: true } });
  const job = await db.catalogPlaylistRefresh.create({ data: { publicationId: publication.id, festivalSlug: slug, requestedAt: new Date('1800-01-01') } });
  try {
    const { claim } = await claimPlaylistRefresh(db, { owner: randomUUID(), ttlMs: 120_000 });
    assert.ok(claim); assert.equal(claim.id, job.id);
    const plan = { slug, editionYear: 2027, expectedUrl: '', title: 'Synthetic 2027', description: 'Synthetic', videoIds: ['00000000001'], artists: 1, sourceTracks: 1 };
    await stageYoutubePlan(db, claim, plan);
    const state = await youtubeProviderState(db, claim, '', 'read');
    const metadata = { title: plan.title, description: `${plan.description}\n[${state.marker}]` };
    await youtubeProviderState(db, claim, '', 'reserve', metadata);
    const rejection = { status: 403, reason: 'quotaExceeded' };
    await assert.rejects(youtubeProviderState(db, claim, '', 'adopt', { playlistId: 'PLsynthetic001', title: plan.title, description: plan.description }), /Invalid existing/);
    const rejected = await youtubeProviderState(db, claim, '', 'create-rejected', { intent: metadata, rejection });
    assert.equal(rejected.sent, false);
    const adopted = await youtubeProviderState(db, claim, '', 'adopt', { playlistId: 'PLsynthetic001', title: plan.title, description: plan.description });
    assert.equal(adopted.adopted, true);
    assert.equal(adopted.playlistId, 'PLsynthetic001');
    assert.deepEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: job.id } })).youtubeState, adopted);
    const insert = { playlistId: adopted.playlistId, expectedIds: plan.videoIds };
    await youtubeProviderState(db, claim, '', 'insert', insert);
    await assert.rejects(youtubeProviderState(db, claim, '', 'insert-rejected', { intent: insert, rejection: { status: 503, reason: 'backendError' } }), /Invalid YouTube rejection/);
    assert.deepEqual((await youtubeProviderState(db, claim, '', 'read')).pendingInsert, insert);
    // A previously adopted/renamed identity remains protected by immutable ID.
    const archiveKey = 'playlist-provider-archives-v1';
    await db.operationalState.create({ data: { key: archiveKey, payload: { youtube_music: [adopted.playlistId] } } });
    try {
      await assert.rejects(youtubeProviderState(db, claim, '', 'read'), /Archived YouTube/);
      await assert.rejects(youtubeProviderState(db, claim, '', 'insert-rejected', { intent: insert, rejection }), /Archived YouTube/);
      assert.deepEqual((await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: job.id } })).youtubeState, { ...adopted, pendingInsert: insert });
    } finally {
      await db.operationalState.delete({ where: { key: archiveKey } });
    }
    await db.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { attempts: 12 } });
    claim.attempts = 12;
    await finishPlaylistRefresh(db, claim, 'FAILED', { quotaCheckpoint: true });
    const checkpoint = await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: job.id } });
    assert.ok(checkpoint.retryAt && checkpoint.completedAt);
    assert.equal(checkpoint.retryAt.getTime() - checkpoint.completedAt.getTime(), 60_000);
    await db.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { retryAt: new Date('1800-01-01') } });
    const retry = (await claimPlaylistRefresh(db, { owner: randomUUID(), ttlMs: 120_000 })).claim;
    assert.ok(retry); assert.equal(retry.id, job.id);
    await db.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${job.id}`;
    await assert.rejects(youtubeProviderState(db, retry, '', 'insert-rejected', { intent: insert, rejection }), PlaylistLeaseLostError);
    const retained = (await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: job.id } })).youtubeState as { pendingInsert: unknown };
    assert.deepEqual(retained.pendingInsert, insert);
  } finally {
    await db.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseExpiresAt: null } });
    await db.festival.delete({ where: { id: festival.id } });
  }
});
