import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
test.after(async () => { await db.$disconnect(); });

test('actual worker pipes durable plans to Python and commits fenced read-back without any plan files', async () => {
  const slug = 'fileless-' + randomUUID();
  const directory = await mkdtemp('/tmp/fileless-worker-test-');
  const previous = await db.operationalState.findUnique({ where: { key: 'playlist-cutover' } });
  let festivalId: string | undefined;
  let artistId: string | undefined;
  try {
    await db.operationalState.upsert({ where: { key: 'playlist-cutover' }, create: { key: 'playlist-cutover', payload: { version: 1, mode: 'database', reconciled: true, legacyDrained: true, commit: 'a'.repeat(40), queueHash: 'b'.repeat(64) } }, update: { payload: { version: 1, mode: 'database', reconciled: true, legacyDrained: true, commit: 'a'.repeat(40), queueHash: 'b'.repeat(64) } } });
    const artist = await db.artist.create({ data: { slug, name: 'Example Artist', aliases: [], genres: [], identityState: 'UNRESOLVED', topTracks: [], recentSetlists: [], freshness: {} } });
    artistId = artist.id;
    const spotifyUrl = 'https://open.spotify.com/playlist/' + 'a'.repeat(22);
    const youtubeUrl = 'https://music.youtube.com/playlist?list=PLsynthetic001';
    const festival = await db.festival.create({ data: { slug, name: 'Synthetic', country: 'Test', countryCode: 'DE', genres: [], officialUrl: 'https://example.test/', editions: { create: { year: 2027, startDate: new Date('2027-06-01'), endDate: new Date('2027-06-02'), status: 'PARTIAL', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'PARTIAL', sourceUpdatedAt: new Date(), playlists: { create: [{ provider: 'spotify', url: spotifyUrl }, { provider: 'youtube_music', url: youtubeUrl }] } } } }, include: { editions: true } });
    festivalId = festival.id;
    await db.lineupEntry.create({ data: { editionId: festival.editions[0].id, artistId: artist.id, billing: 'HEADLINER', position: 0 } });
    const publication = await db.catalogPublication.create({ data: { source: 'ADMIN', sourceId: slug, festivalSlug: slug, editionYear: 2027, actorLabel: 'test', fields: ['lineup'], lineupChanged: true } });
    const desiredPlan = { slug, edition_year: 2027, playlist_url: spotifyUrl, playlist_id: 'a'.repeat(22), playlist_name: 'Synthetic', festival: 'Synthetic', track_uris: ['spotify:track:' + 'b'.repeat(22)], track_count: 1, artists_count: 1 };
    const youtubePlan = { slug, editionYear: 2027, expectedUrl: youtubeUrl, title: 'Synthetic', description: 'Synthetic description', videoIds: ['00000000001'], artists: 1, sourceTracks: 1 };
    const job = await db.catalogPlaylistRefresh.create({ data: { publicationId: publication.id, festivalSlug: slug, requestedAt: new Date('1900-01-01'), desiredPlan, youtubePlan } });
    const launcher = path.join(directory, 'python');
    await writeFile(launcher, await readFile('tests/fixtures/fileless-provider.py'), { mode: 0o700 });
    const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', 'scripts/playlist-worker.ts'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PLAYLIST_LOCK_HELD: 'true', PLAYLIST_PYTHON: launcher, PLAYLIST_WORK_DIRECTORY: directory, YOUTUBE_MUSIC_CREDENTIALS_FILE: 'must-not-read', YOUTUBE_MUSIC_OAUTH_FILE: 'must-not-read' }, timeout: 120_000, maxBuffer: 64_000 });
    assert.equal(JSON.parse(result.stdout).status, 'SUCCEEDED');
    const after = await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, 'SUCCEEDED');
    assert.equal(after.leaseOwner, null);
    assert.deepEqual(after.desiredPlan, desiredPlan);
    assert.deepEqual(after.youtubePlan, youtubePlan);
    assert.equal((after.youtubeProgress as { complete: boolean }).complete, true);
    const bindings = await db.festivalPlaylist.findMany({ where: { editionId: festival.editions[0].id } });
    assert.equal(bindings.length, 2);
    assert.ok(bindings.every(item => item.syncedAt && item.trackCount === 1));
    assert.equal(bindings.find(item => item.provider === 'spotify')!.url, spotifyUrl);
    assert.equal(bindings.find(item => item.provider === 'youtube_music')!.url, youtubeUrl);
    assert.deepEqual(await readdir(directory), ['python']);
  } finally {
    await db.catalogPlaylistRefresh.updateMany({ where: { festivalSlug: slug }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseExpiresAt: null } });
    if (festivalId) await db.festival.delete({ where: { id: festivalId } });
    if (artistId) await db.artist.delete({ where: { id: artistId } });
    if (previous) await db.operationalState.update({ where: { key: 'playlist-cutover' }, data: { payload: previous.payload === null ? Prisma.JsonNull : previous.payload } });
    else await db.operationalState.deleteMany({ where: { key: 'playlist-cutover' } });
    await rm(directory, { recursive: true, force: true });
  }
});
