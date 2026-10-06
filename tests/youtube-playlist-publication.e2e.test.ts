import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { runPlaylistWorker, type ProviderPlaylistResult } from '../lib/catalog/playlist-worker.ts';
import { claimPlaylistRefresh, PlaylistLeaseLostError } from '../lib/catalog/playlist-queue.ts';
import { stageYoutubePlan, youtubeProviderState, saveYoutubeProgress, type YoutubePlan, type YoutubeState } from '../lib/catalog/youtube-playlist-queue.ts';

const url = process.env.PLAYLIST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !/(?:test|integration)/i.test(parsed.pathname) || parsed.searchParams.has('host') || parsed.searchParams.has('hostaddr')) throw new Error('Disposable local playlist test DB required');
}

test('DB/Python publication recovers unknown create and insert across jobs without duplicates', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const directory = await mkdtemp('/tmp/youtube-db-publication-test-');
  const slug = `youtube-test-${randomUUID()}`;
  const spotifyUrl = 'https://open.spotify.com/playlist/' + randomUUID().replace(/-/g, '').slice(0, 22);
  const youtubeUrl = 'https://music.youtube.com/playlist?list=PLsynthetic001';
  let editionId: string;
  try {
    const festival = await db.festival.create({ data: {
      slug, name: 'Synthetic festival', country: 'Test', countryCode: 'DE', genres: [], officialUrl: 'https://example.test/',
      editions: { create: { year: 2027, startDate: new Date('2027-06-01'), endDate: new Date('2027-06-02'), status: 'TBA', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'TBA', sourceUpdatedAt: new Date('2026-01-01'), playlists: { create: { provider: 'spotify', url: spotifyUrl } } } },
    }, include: { editions: true } });
    editionId = festival.editions[0].id;
    const basePlan: YoutubePlan = { slug, editionYear: 2027, expectedUrl: '', title: 'Synthetic festival', description: 'Synthetic description', videoIds: ['00000000001', '00000000002'], artists: 1, sourceTracks: 2 };
    const attempt = async (offset: number, unknown?: string) => {
      // Keep failed fixtures out of the bounded worker scan during this test.
      await db.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "retryAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 day' WHERE "festivalSlug" = ${slug} AND status = 'FAILED'`;
      const publication = await db.catalogPublication.create({ data: {
        source: 'INGESTION', sourceId: `youtube:${randomUUID()}`, festivalSlug: slug, editionYear: 2027,
        actorLabel: 'test', fields: ['lineup'], lineupChanged: true, createdAt: new Date(Date.UTC(2027, 0, 1, 0, 0, offset)),
      } });
      const job = await db.catalogPlaylistRefresh.create({ data: { publicationId: publication.id, festivalSlug: slug, requestedAt: new Date(Date.UTC(1999, 0, 1, 0, 0, offset)) } });
      const execute = () => runPlaylistWorker(db, async active => {
        assert.equal(active.id, job.id);
        const plan = { ...basePlan, title: `Synthetic title ${offset}` };
        await stageYoutubePlan(db, active, plan);
        assert.deepEqual(await stageYoutubePlan(db, active, { ...plan, videoIds: ['00000000003'] }), plan);
        const planPath = path.join(directory, 'plan.json');
        await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
        const child = await promisify(execFile)('python3', [path.join(process.cwd(), 'tests/fixtures/youtube-db-provider.py'), planPath, path.join(directory, 'remote.json'), ...(unknown ? [unknown] : [])], {
          env: { NODE_ENV: 'test', PATH: process.env.PATH, DATABASE_URL: url, PLAYLIST_PROVIDER: 'youtube_music', PLAYLIST_LEASE: JSON.stringify(active), YOUTUBE_EXPECTED_URL: '', PLAYLIST_GUARD_NODE: process.execPath, YOUTUBE_GUARD_SCRIPT: path.join(process.cwd(), 'scripts/playlist-lease-guard.ts'), PYTHONDONTWRITEBYTECODE: '1' },
          encoding: 'utf8', timeout: 120_000, maxBuffer: 64_000,
        });
        const youtubeMusic = JSON.parse(child.stdout) as ProviderPlaylistResult;
        return { url: spotifyUrl, artists: 1, tracks: 2, youtubeMusic };
      });
      return { job, execute };
    };
    const first = await attempt(0, 'create');
    await assert.rejects(first.execute());
    const original = await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: first.job.id } });
    assert.equal((original.youtubeState as unknown as YoutubeState).sent, true);
    assert.equal((original.youtubeState as unknown as YoutubeState).playlistId, null);
    assert.equal(original.status, 'FAILED');
    const second = await attempt(1, 'insert');
    await assert.rejects(second.execute());
    const ambiguous = await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: second.job.id } });
    assert.ok((ambiguous.youtubeState as unknown as YoutubeState).pendingInsert);
    assert.equal((ambiguous.youtubeState as unknown as YoutubeState).marker, (original.youtubeState as unknown as YoutubeState).marker);
    assert.equal(await db.festivalPlaylist.count({ where: { editionId, provider: 'youtube_music' } }), 0);
    assert.equal((await db.festivalPlaylist.findFirstOrThrow({ where: { editionId, provider: 'spotify' } })).syncedAt, null);
    const third = await attempt(2);
    assert.equal((await third.execute()).status, 'SUCCEEDED');
    const bindings = await db.festivalPlaylist.findMany({ where: { editionId } });
    assert.equal(bindings.length, 2);
    assert.equal(bindings.find(item => item.provider === 'youtube_music')?.url, youtubeUrl);
    assert.ok(bindings.every(item => item.syncedAt && item.trackCount === 2));
    const remote = JSON.parse(await readFile(path.join(directory, 'remote.json'), 'utf8'));
    assert.equal(remote.calls.filter((call: string[]) => call[0] === 'POST' && call[1] === 'playlists').length, 1);
    assert.equal(remote.calls.filter((call: string[]) => call[0] === 'POST' && call[1] === 'playlistItems').length, 2);
    assert.deepEqual(remote.items.map((item: { video: string }) => item.video), basePlan.videoIds);

    // Reclaimed/stale handles cannot checkpoint or mutate provider intent.
    const fourth = await db.catalogPublication.create({ data: { source: 'INGESTION', sourceId: `youtube:${randomUUID()}`, festivalSlug: slug, editionYear: 2027, actorLabel: 'test', fields: ['lineup'], lineupChanged: true, createdAt: new Date('2027-01-02') } });
    await db.catalogPlaylistRefresh.create({ data: { publicationId: fourth.id, festivalSlug: slug, requestedAt: new Date('1999-01-02') } });
    const claim = (await claimPlaylistRefresh(db, { owner: randomUUID(), ttlMs: 120_000 })).claim;
    assert.ok(claim);
    assert.equal(claim.publicationId, fourth.id);
    await stageYoutubePlan(db, claim, { ...basePlan, expectedUrl: youtubeUrl });
    await db.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${claim.id}`;
    await assert.rejects(youtubeProviderState(db, claim, youtubeUrl, 'insert', { playlistId: 'PLsynthetic001', expectedIds: ['00000000001'] }), PlaylistLeaseLostError);
    await assert.rejects(saveYoutubeProgress(db, claim, youtubeUrl, { verifiedTracks: 2, totalTracks: 2, quotaUsed: 1, complete: true }), PlaylistLeaseLostError);
  } finally {
    await db.catalogPlaylistRefresh.updateMany({ where: { festivalSlug: slug }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseExpiresAt: null } });
    await db.festival.deleteMany({ where: { slug } });
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
