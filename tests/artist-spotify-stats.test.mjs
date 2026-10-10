import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { verifiedSpotifyArtistId } from '../lib/artist-spotify-identity.ts';
import { parseSpotifyArtistStats, refreshSpotifyArtistStats, spotifyArtistFetcher } from '../lib/catalog/artist-spotify-stats.ts';
import { runEnrichment } from '../scripts/enrich-artists.mjs';

const id = '1234567890123456789012', other = '2234567890123456789012';
const checkedAt = new Date('2026-10-08T12:00:00Z');
const lease = { key: 'artist-enrichment', owner: 'test' };
function fixture() {
  let artist = { id: 'canonical', slug: 'synthetic', identityState: 'LINKED',
    identities: [{ provider: 'spotify', externalId: id }],
    links: [{ source: 'spotify', verified: true, url: `https://open.spotify.com/artist/${id}` }],
    spotifyPopularity: 20, spotifyFollowers: BigInt(123), spotifyStatsCheckedAt: new Date('2026-10-01'),
    spotifyStatsArtistId: id, spotifyStatsSourceUrl: `https://api.spotify.com/v1/artists/${id}` };
  let validLease = true, ownerId = 'canonical', reads = 0, writes = 0;
  const findUnique = async () => structuredClone(artist);
  const db = { artist: { findUnique }, async $transaction(fn) {
    const snapshot = structuredClone(artist);
    try { return await fn({
      $queryRaw: async () => (++reads === 2 && !validLease) ? [] : [{ key: lease.key }],
      artist: { findUnique, update: async ({ data }) => { writes++; Object.assign(artist, data); } },
      artistIdentity: { findUnique: async () => ({ artistId: ownerId }) },
    }); } catch (e) { artist = snapshot; throw e; }
  } };
  return { db, get artist() { return artist; }, get writes() { return writes; },
    loseLease() { validLease = false; }, changeOwner() { ownerId = 'other'; } };
}
const response = (popularity = 80, total = 2345) => ({ id, type: 'artist', name: 'A homonym', popularity, followers: { total } });
const refresh = (f, fetchArtist) => refreshSpotifyArtistStats({ db: f.db, lease, slug: 'synthetic', fetchArtist, now: () => checkedAt });

test('identity requires canonical ID and a single verified agreeing Spotify link, never a name', () => {
  assert.equal(verifiedSpotifyArtistId(fixture().artist), id);
  for (const change of [
    a => { a.identityState = 'AMBIGUOUS'; }, a => { a.identityState = 'UNRESOLVED'; },
    a => { a.identities = []; }, a => { a.links[0].verified = false; },
    a => { a.links[0].url = `https://open.spotify.com/artist/${other}`; },
    a => { a.identities.push({ provider: 'spotify', externalId: other }); },
    a => { a.links.push({ source: 'spotify', verified: true, url: `https://open.spotify.com/artist/${other}` }); },
    a => { a.links.push({ source: 'spotify', verified: true, url: 'https://open.spotify.com/track/123' }); },
  ]) { const a = fixture().artist; change(a); assert.equal(verifiedSpotifyArtistId(a), null); }
});
test('successful refresh updates both stats with ID, source and time; missing/deprecated fields become null', async () => {
  const f = fixture();
  assert.equal(await refresh(f, async requested => { assert.equal(requested, id); return response(); }), 'updated');
  assert.equal(f.artist.spotifyPopularity, 80); assert.equal(f.artist.spotifyFollowers, BigInt(2345));
  assert.equal(f.artist.spotifyStatsArtistId, id); assert.equal(f.artist.spotifyStatsSourceUrl, `https://api.spotify.com/v1/artists/${id}`);
  assert.deepEqual(f.artist.spotifyStatsCheckedAt, checkedAt);
  const missing = fixture(); await refresh(missing, async () => ({ id, type: 'artist' }));
  assert.equal(missing.artist.spotifyPopularity, null); assert.equal(missing.artist.spotifyFollowers, null);
  assert.deepEqual(parseSpotifyArtistStats(response(0, 0), id), { popularity: 0, followers: 0 });
  for (const bad of [-1, 101, NaN, '10']) assert.equal(parseSpotifyArtistStats(response(bad), id).popularity, null);
  for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '20']) assert.equal(parseSpotifyArtistStats(response(80, bad), id).followers, null);
});
test('temporary provider errors and wrong response identities preserve older stats and their timestamp', async () => {
  for (const fetchArtist of [async () => { throw new Error('429/403/transport'); }, async () => ({ ...response(), id: other }), async () => ({ ...response(), type: 'track' })]) {
    const f = fixture(), before = structuredClone(f.artist);
    assert.equal(await refresh(f, fetchArtist), 'unavailable');
    assert.deepEqual(f.artist, before); assert.equal(f.writes, 0);
  }
});
test('unverified artists cause no API requests; changed ownership or identity during fetch cannot write', async () => {
  const f = fixture(); f.artist.links[0].verified = false;
  assert.equal(await refresh(f, async () => { assert.fail('must not fetch a name-only candidate'); }), 'unverified');
  for (const mutate of [g => g.changeOwner(), g => { g.artist.identities[0].externalId = other; }, g => { g.artist.identityState = 'AMBIGUOUS'; }]) {
    const g = fixture(); assert.equal(await refresh(g, async () => { mutate(g); return response(); }), 'unverified'); assert.equal(g.writes, 0);
  }
});
test('expired lease rolls back stats; newer observations cannot be overwritten', async () => {
  const f = fixture(), before = structuredClone(f.artist); f.loseLease();
  await assert.rejects(refresh(f, async () => response()), /lease lost/); assert.deepEqual(f.artist, before);
  const g = fixture(); g.artist.spotifyStatsCheckedAt = new Date('2026-10-09');
  assert.equal(await refresh(g, async () => response()), 'older'); assert.equal(g.writes, 0);
});
test('worker invokes stats refresh on due artist information refresh and retains its existing daily gate', async () => {
  const store = { payload: {}, async save(value) { this.payload = structuredClone(value); } };
  let calls = 0;
  const options = { db: {}, store, publish: async () => null, now: () => checkedAt, pause: async () => {},
    readArtists: async () => [{ slug: 'synthetic', name: 'Synthetic' }],
    refreshSpotify: async slug => { assert.equal(slug, 'synthetic'); calls++; },
    fetchSearch: async () => ({ count: 0, artists: [] }) };
  await runEnrichment(options); assert.equal(calls, 1);
  await runEnrichment(options); assert.equal(calls, 1);
  await runEnrichment({ ...options, now: () => new Date('2026-10-10') }); assert.equal(calls, 2);
});
test('EN/DE/RU accurately label index and followers, unknowns and all four lineup options', async () => {
  const provider = await readFile(new URL('../components/LanguageProvider.tsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../components/ArtistDetail.tsx', import.meta.url), 'utf8');
  const lineup = await readFile(new URL('../components/FestivalDetail.tsx', import.meta.url), 'utf8');
  for (const [lang, followers] of Object.entries({ en: 'Spotify followers', de: 'Spotify-Follower', ru: 'Подписчики Spotify' })) {
    const block = provider.match(new RegExp(`\\n  ${lang}: \\{([\\s\\S]*?)\\n  \\},`))[1];
    assert.ok(block.includes(followers)); assert.ok(block.includes('0–100'));
    for (const key of ['lineupSort', 'lineupOfficial', 'lineupAlphabetical', 'lineupChronological', 'lineupPopularity', 'statsUnknown']) assert.ok(block.includes(`${key}:`));
  }
  for (const key of ['spotifyPopularityIndex', 'spotifyFollowers', 'statsUnknown']) assert.ok(detail.includes(`t("${key}")`));
  assert.match(detail, /popularity \?\? t\("statsUnknown"\)/);
  assert.match(detail, /followers == null/);
  assert.match(lineup, /useState<LineupSort>\("official"\)/);
  assert.match(lineup, /item.headliners.map/); assert.match(lineup, /sortedLineup.map/);
  assert.doesNotMatch(detail, /monthly listeners|monatliche Hörer|слушател.*месяц/i);
});

test('repository projects serializable Spotify stats and suppresses a stale or unverified binding', async () => {
  const { DatabaseCatalogRepository } = await import('../lib/catalog/repository.ts');
  const f = fixture(); Object.assign(f.artist, { name: 'Synthetic', aliases: [], genres: [], provenance: [], topTracks: [], recentSetlists: [], freshness: {} });
  const row = { festival: { slug: 'synthetic-fest', name: 'Synthetic Fest', countryCode: 'DE', country: 'Germany', officialUrl: 'https://example.test', genres: [], latitude: null, longitude: null },
    year: 2027, startDate: null, endDate: null, snapshotAt: null, sourceUpdatedAt: checkedAt, status: 'PARTIAL', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'PARTIAL',
    lineup: [{ billing: 'LINEUP', artist: { name: 'Synthetic' } }], timetable: [], provenance: [], playlists: [] };
  const repository = new DatabaseCatalogRepository({ artist: { findMany: async () => [f.artist] }, festivalEdition: { findMany: async () => [row] } });
  let snapshot = await repository.read();
  assert.equal(snapshot.artists[0].spotifyStats.followers, 123);
  assert.equal(snapshot.artists[0].spotifyStats.checkedAt, '2026-10-01T00:00:00.000Z');
  assert.doesNotThrow(() => JSON.stringify(snapshot));
  f.artist.spotifyStatsArtistId = null;
  snapshot = await repository.read(); assert.equal(snapshot.artists[0].spotifyStats, undefined);
  f.artist.spotifyStatsArtistId = other;
  snapshot = await repository.read(); assert.equal(snapshot.artists[0].spotifyStats, undefined);
  f.artist.spotifyStatsArtistId = id; f.artist.links[0].verified = false;
  snapshot = await repository.read(); assert.equal(snapshot.artists[0].spotifyStats, undefined);
});


test('mocked Web API fetch uses Get Artist by verified ID, reuses token and stops requests on failure', async () => {
  const urls = [];
  const fetchArtist = spotifyArtistFetcher(async url => {
    urls.push(url);
    if (url.endsWith('/api/token')) return Response.json({ access_token: 'synthetic-test-token', expires_in: 3600 });
    return Response.json(response());
  }, () => ({ clientId: 'synthetic', secret: 'synthetic' }));
  await fetchArtist(id); await fetchArtist(id);
  assert.deepEqual(urls, ['https://accounts.spotify.com/api/token', `https://api.spotify.com/v1/artists/${id}`, `https://api.spotify.com/v1/artists/${id}`]);
  let calls = 0;
  const unavailable = spotifyArtistFetcher(async url => {
    calls++;
    if (url.endsWith('/api/token')) return Response.json({ access_token: 'synthetic-test-token' });
    return new Response(null, { status: 429 });
  }, () => ({ clientId: 'synthetic', secret: 'synthetic' }));
  await assert.rejects(unavailable(id), /stats_unavailable/);
  await assert.rejects(unavailable(other), /stats_unavailable/);
  assert.equal(calls, 2);
  const missing = spotifyArtistFetcher(async () => { assert.fail('missing configuration must not call API'); }, () => ({}));
  await assert.rejects(missing(id), /stats_unavailable/);
});

test('a single 404 artist does not disable statistics for other artists', async () => {
  const urls = [];
  const fetchArtist = spotifyArtistFetcher(async url => {
    urls.push(url);
    if (url.endsWith('/api/token')) return Response.json({ access_token: 'synthetic-test-token' });
    if (url.endsWith(id)) return new Response(null, { status: 404 });
    return Response.json({ ...response(), id: other });
  }, () => ({ clientId: 'synthetic', secret: 'synthetic' }));
  await assert.rejects(fetchArtist(id), /stats_unavailable/);
  assert.equal((await fetchArtist(other)).id, other);
  assert.equal(urls.length, 3);
});


test('resolver-backed publication rejects ambiguous, name-only and mismatched live observations', async () => {
  const { spotifyResolution } = await import('../lib/catalog/spotify-identity-publication.ts');
  const mb = '11111111-1111-4111-8111-111111111111';
  const proof = { name: 'Synthetic', status: 'linked', linked: [{ spotify: { id, name: 'Synthetic', url: `https://open.spotify.com/artist/${id}` }, musicBrainz: { id: mb, name: 'Synthetic', url: `https://musicbrainz.org/artist/${mb}`, spotifyUrls: [`https://open.spotify.com/artist/${id}`] } }] };
  const live = { id, type: 'artist', name: 'Synthetic' };
  assert.equal(spotifyResolution(proof, 'Synthetic', live).spotifyId, id);
  for (const mutate of [p => p.status = 'ambiguous', p => p.linked.push(p.linked[0]), p => p.linked[0].musicBrainz.spotifyUrls = [], p => p.linked[0].spotify.name = 'Other band']) {
    const p = structuredClone(proof); mutate(p); assert.equal(spotifyResolution(p, 'Synthetic', live), null);
  }
  assert.equal(spotifyResolution(proof, 'Synthetic', { ...live, name: 'Homonym' }), null);
  assert.equal(spotifyResolution(proof, 'Synthetic', { ...live, id: other }), null);
});
