import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {PrismaClient} from '@prisma/client';
import {requireLocalDisposableDatabase} from './support/disposable-db.ts';
import {spotifyRepertoiresForArtists} from '../lib/catalog/spotify-repertoire.ts';

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
test.after(() => db.$disconnect());
test('configuration preview/apply, DB worker transport and idempotency do not alter identities, plans or providers', async () => {
  const slug = 'test-repertoire-' + randomUUID();
  await db.artist.create({data: {slug, name: slug, aliases: [], genres: [], topTracks: [], recentSetlists: [], freshness: {}, identityState: 'UNRESOLVED'}});
  const profile = {schemaVersion: 1, key: slug + ':v1', artistSlugs: [slug], setlistArtist: 'Anchor',
    searchArtists: [{id: 'a'.repeat(22), name: 'Anchor'}, {id: 'b'.repeat(22), name: 'Singer'}, {id: 'c'.repeat(22), name: 'Singer & Band'}],
    anchorArtistIds: ['a'.repeat(22)], collaborationArtistIds: ['b'.repeat(22), 'c'.repeat(22)], albumIds: ['d'.repeat(22)],
    sourceUrls: ['https://open.spotify.com/album/' + 'd'.repeat(22)]};
  const invoke = (value, apply = false) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/configure-spotify-repertoire.ts', ...(apply ? ['--apply'] : [])],
    {input: JSON.stringify(value), encoding: 'utf8', timeout: 20000, env: process.env});
  const before = {identities: await db.artistIdentity.count(), lineup: await db.lineupEntry.count(), jobs: await db.catalogPlaylistRefresh.count()};
  const keys = ['spotify-repertoire-profile:' + profile.key, 'spotify-repertoire-binding:' + slug, 'spotify-repertoire-audit:' + profile.key];
  const preview = invoke(profile);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).apply, false);
  assert.equal(await db.operationalState.count({where: {key: {in: keys}}}), 0);
  const applied = invoke(profile, true);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(await db.operationalState.count({where: {key: {in: keys}}}), 3);
  const transported = await spotifyRepertoiresForArtists(db, [{slug, name: slug}]);
  assert.deepEqual(transported[slug], profile);
  const replay = invoke(profile, true);
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).existing, true);
  assert.equal(await db.operationalState.count({where: {key: {in: keys}}}), 3);
  assert.notEqual(invoke({...profile, setlistArtist: 'Different'}, true).status, 0);
  assert.notEqual(invoke({...profile, key: slug + ':v2'}, true).status, 0);
  assert.equal(await db.operationalState.count({where: {key: 'spotify-repertoire-profile:' + slug + ':v2'}}), 0);
  assert.notEqual(invoke({...profile, artistSlugs: ['nonexistent-' + randomUUID()]}, true).status, 0);
  assert.deepEqual({identities: await db.artistIdentity.count(), lineup: await db.lineupEntry.count(), jobs: await db.catalogPlaylistRefresh.count()}, before);
  assert.deepEqual((await spotifyRepertoiresForArtists(db, [{slug, name: slug}]))[slug], profile);
});
