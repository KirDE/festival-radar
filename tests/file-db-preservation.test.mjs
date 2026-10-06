import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { auditCommand, comparePreservation, digest, preserves, projectCatalog, projectDatabase, projectOperational, projectPlaylistState, readDatabaseSnapshot, readFiles } from '../scripts/audit-file-db-preservation.mjs';

const earlier = '2026-01-01T00:00:00.000Z';
const later = '2026-02-01T00:00:00.000Z';
const item = (key, value, observedAt = earlier, owned = false, invalid = false) => ({ key, value, observedAt, owned, invalid });
const counts = (files, db, scope = 'artists') => comparePreservation({ [scope]: files }, { [scope]: db }).scopes[scope].categories;

function fixture() {
  const festival = { id: 'synthetic-festival-id', slug: 'synthetic', name: 'Synthetic Festival', country: 'Test', countryCode: 'TT', city: null, officialUrl: 'https://example.invalid/festival', genres: ['test'], latitude: null, longitude: null };
  const artist = { id: 'synthetic-artist-id', slug: 'synthetic-artist', name: 'Synthetic Artist', aliases: [], genres: [], origin: null, biography: null, imageUrl: null, identityState: 'LINKED', topTracks: [], recentSetlists: [], freshness: { profile: { checkedAt: '2026-01-01', cadenceDays: 90, refreshAfter: '2026-04-01' } }, identities: [{ provider: 'spotify', externalId: 'synthetic-binding' }], links: [{ label: 'Official', url: 'https://example.invalid/artist', source: 'official', verified: true }], provenance: [{ field: 'identity', source: 'official', url: 'https://example.invalid/artist', checkedAt: new Date(earlier) }] };
  const edition = { id: 'synthetic-edition-id', festivalId: festival.id, festival, year: 2026, startDate: new Date(earlier), endDate: null, dateLabel: null, status: 'CONFIRMED', ticketStatus: 'UNKNOWN', ticketsUrl: null, recordState: 'ARCHIVED', completeness: 'COMPLETE', snapshotAt: null, sourceUpdatedAt: new Date(earlier), lineup: [{ billing: 'HEADLINER', position: 0, status: 'ANNOUNCED', artist }], provenance: [{ field: 'edition', url: festival.officialUrl, note: 'synthetic evidence', checkedAt: new Date(earlier) }], timetable: [{ artist, artistName: artist.name, date: new Date(earlier), stage: 'Synthetic Stage', start: '12:00', timeZone: 'UTC', sourceUrl: festival.officialUrl, observedAt: new Date(earlier), status: 'ANNOUNCED' }], playlists: [{ provider: 'spotify', url: 'https://example.invalid/playlist', artistCount: 1, trackCount: 2, syncedAt: new Date(earlier) }] };
  const bytes = Buffer.from('synthetic logo bytes');
  const binding = createHash('sha256').update(bytes).digest('hex');
  const source = { festivalSlug: festival.slug, festivalId: festival.id, editionYear: edition.year, festival, edition, url: festival.officialUrl, strategies: ['manual_review'], refreshPolicy: 'weekly', enabled: true, manualReviewReason: 'synthetic review', parserKey: 'manual_review', cadenceSeconds: 604800, requestHeaders: null, configurationBackfilledAt: new Date(earlier) };
  const snapshot = { festivals: [festival], editions: [edition], artists: [artist], sources: [source], logos: [{ festival, assetHash: binding, asset: { sha256: binding, mimeType: 'image/png', sizeBytes: bytes.length, bytes } }], operational: [{ key: 'artist-enrichment', payload: { schemaVersion: 1, generatedAt: earlier, profiles: { 'synthetic-artist': { identities: { musicbrainz: 'synthetic-candidate' } } }, manualReview: [{ slug: 'synthetic-review', reason: 'ambiguous', candidateIds: ['synthetic-candidate'] }] } }, { key: 'artist-identities', payload: { schemaVersion: 1, updatedAt: earlier, artists: { 'Synthetic Artist': { status: 'linked', linked: { spotify: 'synthetic-binding' }, base: { attempts: 1 } } } } }] };
  const files = projectCatalog({ festivals: [festival], editions: [{ slug: festival.slug, editionYear: edition.year, startDate: '2026-01-01', endDate: null, dateLabel: null, status: 'confirmed', ticketStatus: 'unknown', ticketsUrl: null, recordState: 'archived', completeness: 'complete', updatedAt: earlier, headliners: [artist.name], lineup: [], provenance: [{ field: 'edition', url: festival.officialUrl, note: 'synthetic evidence', checkedAt: earlier }], timetable: [{ date: '2026-01-01', artist: artist.name, stage: 'Synthetic Stage', start: '12:00', timeZone: 'UTC', sourceUrl: festival.officialUrl, observedAt: earlier }] }], artists: [{ ...artist, identityState: 'linked', identities: { spotify: 'synthetic-binding' }, provenance: [{ field: 'identity', source: 'official', url: 'https://example.invalid/artist', checkedAt: '2026-01-01' }] }] });
  const database = projectDatabase(snapshot);
  files.sources = structuredClone(database.sources);
  files.logos = structuredClone(database.logos);
  files.playlists = structuredClone(database.playlists);
  projectOperational(files, snapshot.operational[0].payload, snapshot.operational[1].payload);
  return { files, database, snapshot };
}

test('semantic projection matches archived catalogue, provenance, timetable and operational documents', () => {
  const { files, database } = fixture();
  const report = comparePreservation(files, database);
  assert.equal(report.unresolvedCount, 0);
  assert.equal(report.reviewCount, 0);
  for (const scope of ['festivals', 'editions', 'lineup', 'artists', 'artist_identities', 'artist_links', 'artist_provenance', 'edition_provenance', 'timetable', 'sources', 'logos', 'playlists', 'enrichment_profiles', 'enrichment_review', 'identity_state']) assert.equal(report.scopes[scope].categories.equal, 1, scope);
});

test('additive DB content, new editions and optional fields do not require seed equality', () => {
  assert.equal(preserves({ aliases: ['a'], biography: null }, { aliases: ['a', 'b'], biography: 'new', extra: true }), true);
  assert.equal(preserves(['a', 'b'], ['b', 'a']), false);
  assert.equal(preserves(['a', 'a'], ['a']), false);
  const { files, database } = fixture();
  database.artists[0].value.aliases.push('new alias');
  database.editions.push(item('new-db-edition', { recordState: 'tracking' }, later));
  const report = comparePreservation(files, database);
  assert.equal(report.unresolvedCount, 0);
  assert.equal(report.scopes.artists.categories.preserved_with_db_additions, 1);
  assert.equal(report.scopes.editions.categories.db_only, 1);
  assert.notEqual(report.scopes.artists.fileHash, report.scopes.artists.dbHash);
});

test('additional lineup artists may shift numeric positions while retaining original order', () => {
  const { files, database } = fixture();
  const original = database.lineup[0];
  original.value.position = 1;
  const [edition] = JSON.parse(original.key);
  database.lineup.push(item(JSON.stringify([edition, 'new-artist']), { name: 'New Artist', billing: 'headliners', position: 0, status: 'announced' }));
  const report = comparePreservation(files, database);
  assert.equal(report.unresolvedCount, 0);
  assert.equal(report.scopes.lineup.categories.preserved_with_db_additions, 1);
  assert.equal(report.scopes.lineup.categories.db_only, 1);
  database.lineup[1].value.position = 1;
  assert.equal(comparePreservation(files, database).scopes.lineup.categories.changed, 1);
});

test('semantic newer observations require review, never attest changed or missing data automatically', () => {
  assert.equal(counts([item('a', { name: 'before' })], [item('a', { name: 'after' }, later)]).newer_db_changed, 1);
  assert.equal(counts([item('a', { name: 'before' })], [item('a', { name: 'before' }, later)]).newer_db_same, 1);
  assert.equal(counts([item('a', { name: 'before' })], [item('b', { name: 'after' }, later)]).missing_in_db, 1);
  const report = comparePreservation({ artists: [item('a', 'old')] }, { artists: [item('a', 'new', later)] });
  assert.equal(report.reviewCount, 1);
});

test('owned source changes are distinct from newer content; lease/update times cannot prove freshness', () => {
  const { files, snapshot } = fixture();
  snapshot.sources[0].enabled = false;
  snapshot.sources[0].updatedAt = new Date(later);
  snapshot.sources[0].lastSuccessAt = new Date(later);
  const report = comparePreservation(files, projectDatabase(snapshot));
  assert.equal(report.scopes.sources.categories.db_owned_changed, 1);
  assert.equal(report.scopes.sources.categories.newer_db_changed, 0);
  snapshot.sources[0].configurationBackfilledAt = null;
  assert.equal(comparePreservation(files, projectDatabase(snapshot)).scopes.sources.categories.changed, 1);
});

test('identity, logo and edition/provider playlist binding replacements remain blockers even when newer', () => {
  for (const scope of ['artist_identities', 'logos', 'playlists']) {
    assert.equal(counts([item('a', { binding: 'old', tracks: 1 })], [item('a', { binding: 'replacement', tracks: 2 }, later, true)], scope).binding_changed, 1);
  }
  assert.equal(counts([item('a', { binding: 'same', tracks: 1 })], [item('a', { binding: 'same', tracks: 2 }, later)], 'playlists').newer_db_changed, 1);
  const { files, snapshot } = fixture();
  snapshot.editions[0].year++;
  assert.equal(comparePreservation(files, projectDatabase(snapshot)).scopes.playlists.categories.missing_in_db, 1);
});

test('cancelled lineup, raw positions and missing timetable artist linkage cannot hide behind UI fallbacks', () => {
  const { files, snapshot } = fixture();
  snapshot.editions[0].lineup[0].status = 'CANCELLED';
  snapshot.editions[0].lineup[0].position = 8;
  snapshot.editions[0].timetable[0].artist = null;
  const report = comparePreservation(files, projectDatabase(snapshot));
  assert.equal(report.scopes.lineup.categories.changed, 1);
  assert.equal(report.scopes.timetable.categories.changed, 1);
});

test('logo bytes integrity and enabled source relation consistency are audited', () => {
  const { files, snapshot } = fixture();
  snapshot.logos[0].asset.bytes = Buffer.from('corrupted');
  snapshot.sources[0].festivalId = 'wrong binding';
  const report = comparePreservation(files, projectDatabase(snapshot));
  assert.equal(report.scopes.logos.categories.invalid_db, 1);
  assert.equal(report.scopes.sources.categories.invalid_db, 1);
});

test('enrichment direct import, runtime wrapper and checkpoint candidates share semantic projection', () => {
  const { files, snapshot } = fixture();
  const payload = snapshot.operational[0].payload;
  snapshot.operational[0].payload = { result: payload, cache: { 'synthetic-artist': { artists: ['cached-candidate'] } }, nextRunAt: later };
  let report = comparePreservation(files, projectDatabase(snapshot));
  assert.equal(report.scopes.enrichment_profiles.categories.equal, 1);
  assert.equal(report.scopes.enrichment_cache.categories.db_only, 1);
  snapshot.operational[0].payload = { profiles: payload.profiles, manualReview: payload.manualReview, cache: {} };
  report = comparePreservation(files, projectDatabase(snapshot));
  assert.equal(report.scopes.enrichment_profiles.categories.equal, 1);
  snapshot.operational[0].payload.profiles = { 'synthetic-artist': { identities: { musicbrainz: 'different-candidate' } } };
  assert.equal(comparePreservation(files, projectDatabase(snapshot)).scopes.enrichment_profiles.categories.db_owned_changed, 1);
});

test('duplicates, invalid operational payloads and absent private identity inputs prevent complete coverage', () => {
  const { files, snapshot } = fixture();
  snapshot.operational[1].payload = { schemaVersion: 2 };
  const report = comparePreservation(files, projectDatabase(snapshot), ['identity_state']);
  assert.equal(report.scopes.identity_state.categories.invalid_db, 1);
  assert.equal(report.scopes.identity_state.categories.unavailable_file_input, 1);
  const duplicate = item('a', 'value');
  assert.equal(counts([duplicate, duplicate], [duplicate, duplicate]).duplicate_file, 1);
  assert.equal(counts([duplicate, duplicate], [duplicate, duplicate]).duplicate_db, 1);
});

test('snapshot executes only reads inside one repeatable-read read-only transaction', async () => {
  const statements = [], queries = [];
  const tx = { $executeRawUnsafe: async sql => statements.push(sql) };
  for (const table of ['festival', 'festivalEdition', 'artist', 'festivalSource', 'festivalLogo', 'operationalState']) tx[table] = { findMany: async args => { queries.push([table, args]); return []; } };
  const client = { $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return callback(tx);
  } };
  await readDatabaseSnapshot(client);
  assert.deepEqual(statements, ['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '45s'"]);
  assert.equal(queries.length, 6);
  assert.equal(queries.find(([table]) => table === 'artist')[1].where, undefined);
  assert.equal(queries.find(([table]) => table === 'festivalEdition')[1].where, undefined);
  assert.deepEqual(queries.find(([table]) => table === 'operationalState')[1].select, { key: true, payload: true });
});

test('report contains only fixed categories/counts/digests, never keys, URLs or provider IDs', async () => {
  const { files, database } = fixture();
  database.artists[0].value.name = 'sensitive-name';
  const text = JSON.stringify(comparePreservation(files, database));
  for (const secret of ['synthetic', 'sensitive-name', 'https:', 'example.invalid', 'candidate', 'spotify']) assert.equal(text.includes(secret), false, secret);
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const emitted = [];
  const exit = await auditCommand({ environment: {}, args: ['--release-root=/private-sensitive-path'], emit: (value, failure) => emitted.push({ value, failure }), openClient: () => { throw new Error('must not connect'); } });
  assert.equal(exit, 1);
  assert.deepEqual(emitted, [{ value: { categories: { audit_failed: 1 } }, failure: true }]);
  emitted.length = 0;
  assert.equal(await auditCommand({ environment: { DATABASE_URL: 'secret' }, args: [], emit: value => emitted.push(value), openClient: () => { throw new Error('postgres://secret:password@private-db'); } }), 1);
  assert.deepEqual(emitted, [{ categories: { audit_failed: 1 } }]);
});

test('current packaged files load locally without a DB; missing identity state remains explicit', async () => {
  const { output, unavailable } = await readFiles(process.cwd());
  const report = comparePreservation(output, output, unavailable);
  assert.deepEqual(unavailable, ['identity_state']);
  assert.equal(report.unresolvedCount, 1);
  assert.ok(output.editions.length > output.festivals.length);
  assert.ok(output.logos.length > 0);
  for (const scope of Object.values(report.scopes)) {
    assert.equal(scope.categories.invalid_file, 0);
    assert.equal(scope.categories.duplicate_file, 0);
  }
});

test('manual audit command runs without development tsx and is present in release packaging', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['catalog:audit-preservation'], 'node --experimental-strip-types scripts/audit-file-db-preservation.mjs');
  const packager = await readFile(new URL('../scripts/deploy/package-release.sh', import.meta.url), 'utf8');
  assert.match(packager, /cp scripts\/audit-file-db-preservation\.mjs /);
  assert.match(packager, /grep -Fxq 'app\/scripts\/audit-file-db-preservation\.mjs'/);
});


function sharedPlaylistFixture(count = 14) {
  const editions = Array.from({ length: count }, (_, index) => ({ slug: `synthetic-${index}`, editionYear: 2027, recordState: 'current' }));
  const state = Object.fromEntries(editions.map((edition, index) => [edition.slug, { spotifyUrl: `https://example.invalid/playlist/synthetic-${index}`, artists: 17, tracks: 83, updatedAt: later }]));
  return { editions, state };
}

test('shared 14-playlist baseline covers rows absent from an 11-playlist packaged baseline', () => {
  const { editions, state } = sharedPlaylistFixture();
  const shared = projectPlaylistState(state, editions);
  const packaged = projectPlaylistState(Object.fromEntries(Object.entries(state).slice(0, 11)), editions);
  const database = structuredClone(shared);
  assert.equal(comparePreservation({ playlists: packaged }, { playlists: database }).scopes.playlists.categories.db_only, 3);
  const report = comparePreservation({ playlists: shared }, { playlists: database });
  assert.equal(report.unresolvedCount, 0);
  assert.equal(report.scopes.playlists.fileCount, 14);
  assert.equal(report.scopes.playlists.categories.equal, 14);
  assert.equal(report.scopes.playlists.categories.db_only, 0);
  database[13].value.binding = 'https://example.invalid/playlist/replaced';
  assert.equal(comparePreservation({ playlists: shared }, { playlists: database }).scopes.playlists.categories.binding_changed, 1);
  const text = JSON.stringify(comparePreservation({ playlists: shared }, { playlists: database }));
  for (const secret of ['example.invalid', 'synthetic-', 'https:']) assert.equal(text.includes(secret), false);
});

test('playlist state supports both providers and YouTube-only status with explicit edition binding', () => {
  const { editions, state } = sharedPlaylistFixture(1);
  state['synthetic-0'].youtubeMusicUrl = 'https://example.invalid/playlist/youtube-synthetic';
  const both = projectPlaylistState(state, editions);
  assert.equal(both.length, 2);
  assert.deepEqual(both.map(item => JSON.parse(item.key)), [['synthetic-0', 2027, 'spotify'], ['synthetic-0', 2027, 'youtube_music']]);
  delete state['synthetic-0'].spotifyUrl;
  assert.equal(projectPlaylistState(state, editions).length, 1);
});

test('playlist shape rejects malformed documents, counts, timestamps, URLs and ambiguous editions', () => {
  const { editions, state } = sharedPlaylistFixture(1);
  const status = state['synthetic-0'];
  const malformed = [null, [], 'secret', {}, { 'synthetic-0': null }, { 'synthetic-0': [] },
    ...[{ artists: -1 }, { artists: 1.5 }, { tracks: '83' }, { tracks: Number.MAX_SAFE_INTEGER + 1 }, { updatedAt: 'invalid-date' }, { updatedAt: earlier.slice(0, 10) }, { spotifyUrl: 'http://example.invalid/playlist' }, { spotifyUrl: 'https://user:secret@example.invalid/playlist' }, { spotifyUrl: 'https://example.invalid/playlist\n' }, { youtubeMusicUrl: null }, { extra: 'not silently dropped' }].map(change => ({ 'synthetic-0': { ...status, ...change } }))];
  const noBinding = { ...status };
  delete noBinding.spotifyUrl;
  malformed.push({ 'synthetic-0': noBinding });
  for (const input of malformed) {
    const rows = projectPlaylistState(input, editions);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].invalid, true);
    assert.equal(comparePreservation({ playlists: rows }, {}).scopes.playlists.categories.invalid_file, 1);
  }
  assert.equal(projectPlaylistState(state, [])[0].invalid, true);
  assert.equal(projectPlaylistState(state, [...editions, ...editions])[0].invalid, true);
});

test('private playlist path replaces packaged state; unavailable and invalid inputs never fall back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'playlist-parity-'));
  try {
    const path = join(directory, 'synthetic-state.json');
    const baseline = await readFiles(process.cwd());
    const [festivalSlug] = JSON.parse(baseline.output.playlists[0].key);
    const state = { [festivalSlug]: { spotifyUrl: 'https://example.invalid/playlist/private-synthetic', artists: 17, tracks: 83, updatedAt: later } };
    await writeFile(path, JSON.stringify(state));
    let files = await readFiles(process.cwd(), undefined, path);
    assert.equal(files.output.playlists.length, 1);
    assert.equal(files.output.playlists[0].value.binding, state[festivalSlug].spotifyUrl);
    assert.equal(files.unavailable.includes('playlists'), false);
    assert.equal(comparePreservation(files.output, files.output, files.unavailable).scopes.playlists.categories.invalid_file, 0);
    files = await readFiles(process.cwd(), undefined, join(directory, 'absent-private-state'));
    assert.equal(files.output.playlists.length, 0);
    assert.equal(comparePreservation(files.output, {}, files.unavailable).scopes.playlists.categories.unavailable_file_input, 1);
    for (const content of ['{private-secret', '[]', '{}', JSON.stringify({ [festivalSlug]: { ...state[festivalSlug], tracks: 'secret' } })]) {
      await writeFile(path, content);
      files = await readFiles(process.cwd(), undefined, path);
      const report = comparePreservation(files.output, {}, files.unavailable);
      assert.equal(report.scopes.playlists.categories.invalid_file, 1);
      assert.equal(report.scopes.playlists.fileCount, 1);
      assert.equal(JSON.stringify(report).includes('private-secret'), false);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI forwards playlist-state and rejects duplicate/empty options without emitting inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'playlist-parity-cli-'));
  try {
    const path = join(directory, 'state.json');
    const baseline = await readFiles(process.cwd());
    const [festivalSlug] = JSON.parse(baseline.output.playlists[0].key);
    await writeFile(path, JSON.stringify({ [festivalSlug]: { spotifyUrl: 'https://example.invalid/playlist/synthetic', artists: 17, tracks: 83, updatedAt: later } }));
    const tx = { $executeRawUnsafe: async () => {} };
    for (const table of ['festival', 'festivalEdition', 'artist', 'festivalSource', 'festivalLogo', 'operationalState']) tx[table] = { findMany: async () => [] };
    let disconnected = false;
    const client = { $transaction: async callback => callback(tx), $disconnect: async () => { disconnected = true; } };
    const emitted = [];
    const options = { environment: { DATABASE_URL: 'synthetic' }, emit: value => emitted.push(value), openClient: async () => client };
    assert.equal(await auditCommand({ ...options, args: [`--playlist-state=${path}`] }), 2);
    assert.equal(disconnected, true);
    assert.equal(emitted[0].scopes.playlists.fileCount, 1);
    emitted.length = 0;
    assert.equal(await auditCommand({ ...options, args: [`--playlist-state=${path}/unavailable`] }), 2);
    assert.equal(emitted[0].scopes.playlists.categories.unavailable_file_input, 1);
    for (const args of [['--playlist-state='], [`--playlist-state=${path}`, '--playlist-state=/private-secret']]) {
      emitted.length = 0;
      assert.equal(await auditCommand({ ...options, args, openClient: () => { throw new Error('must not open'); } }), 1);
      assert.deepEqual(emitted, [{ categories: { audit_failed: 1 } }]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
