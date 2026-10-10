import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { validateDisposableDatabase } from '../scripts/prepare-cutover-test-db.mjs';
import { claimOperationalState } from '../lib/catalog/operational-state.ts';
import { spotifyResolution, publishSpotifyIdentity } from '../lib/catalog/spotify-identity-publication.ts';
import { runSpotifyStats } from '../scripts/refresh-spotify-stats.mjs';
const id = '1234567890123456789012';
const mb = '11111111-1111-4111-8111-111111111111';
const evidence = { name: 'Synthetic', status: 'linked', linked: [{ spotify: { id, name: 'Synthetic', url: `https://open.spotify.com/artist/${id}` }, musicBrainz: { id: mb, name: 'Synthetic', url: `https://musicbrainz.org/artist/${mb}`, spotifyUrls: [`https://open.spotify.com/artist/${id}`] } }] };
const observed = { id, type: 'artist', name: 'Synthetic', popularity: 70, followers: { total: 1234567 } };

test('only one corroborated exact cross-provider match is publishable', () => {
  assert.equal(spotifyResolution(evidence, 'Synthetic', observed).spotifyId, id);
  for (const change of [x => x.linked.push(x.linked[0]), x => x.status = 'ambiguous', x => x.linked[0].musicBrainz.spotifyUrls = [], x => x.linked[0].spotify.name = 'Homonym', x => x.linked[0].musicBrainz.name = 'Other band']) {
    const copy = structuredClone(evidence); change(copy); assert.equal(spotifyResolution(copy, 'Synthetic', observed), null);
  }
  assert.equal(spotifyResolution(evidence, 'Synthetic', { ...observed, name: 'Other band' }), null);
});
const url = process.env.SPOTIFY_STATS_TEST_DATABASE_URL;
if (url) validateDisposableDatabase(url);
test('real DB: resolver proof → canonical identity → stats; MusicBrainz completed checkpoint is irrelevant; fencing and conflicts', { skip: !url }, async () => {
  const db = new PrismaClient({ datasources: { db: { url } } }); let lease;
  try {
    await db.artist.create({ data: { name: 'Synthetic', slug: 'synthetic', aliases: [], genres: [], identityState: 'UNRESOLVED', topTracks: [], recentSetlists: [], freshness: {} } });
    await db.operationalState.create({ data: { key: 'artist-identities', payload: { artists: { Synthetic: evidence } } } });
    lease = await claimOperationalState(db, 'artist-enrichment');
    await lease.save({ work: { complete: false, completed: ['synthetic'] }, cache: { synthetic: {} } });
    let calls = 0;
    const options = { db, lease, fetchArtist: async requested => { calls++; assert.equal(requested, id); return observed; } };
    const summary = await runSpotifyStats(options);
    assert.equal(summary.linked, 1); assert.equal(summary.updated, 1);
    const artist = await db.artist.findUniqueOrThrow({ where: { slug: 'synthetic' }, include: { identities: true, links: true } });
    assert.equal(artist.spotifyPopularity, 70); assert.equal(artist.spotifyFollowers, 1234567n);
    assert.equal(artist.identityState, 'LINKED'); assert.equal(artist.identities[0].externalId, id); assert.equal(artist.links[0].verified, true);
    assert.equal(await db.adminAuditEntry.count({ where: { action: 'ARTIST_SPOTIFY_IDENTITY_PUBLICATION' } }), 1);
    assert.equal((await runSpotifyStats(options)).fresh, 1); assert.equal(calls, 1);
    assert.equal(await publishSpotifyIdentity(db, lease, 'synthetic', observed), 'unchanged');
    await db.artistIdentity.update({ where: { artistId_provider: { artistId: artist.id, provider: 'spotify' } }, data: { externalId: '2234567890123456789012' } });
    assert.equal(await publishSpotifyIdentity(db, lease, 'synthetic', observed), 'conflict');
    await db.operationalState.update({ where: { key: lease.key }, data: { leaseExpiresAt: new Date(0) } });
    await assert.rejects(publishSpotifyIdentity(db, lease, 'synthetic', observed), /lease lost/);
    assert.equal((await db.operationalState.findUniqueOrThrow({ where: { key: lease.key } })).payload.work.completed[0], 'synthetic');
  } finally { await lease?.release(); await db.$disconnect(); }
});
