import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This command never invokes a writer or prints natural keys or exception text.
const scopes = ['festivals', 'editions', 'edition_provenance', 'lineup', 'artists', 'artist_identities', 'artist_links', 'artist_provenance', 'sources', 'timetable', 'enrichment_profiles', 'enrichment_review', 'enrichment_cache', 'identity_state', 'logos', 'playlists'];
const categories = ['equal', 'preserved_with_db_additions', 'newer_db_same', 'db_only', 'missing_in_db', 'newer_db_changed', 'db_owned_changed', 'changed', 'binding_changed', 'invalid_file', 'invalid_db', 'duplicate_file', 'duplicate_db', 'unavailable_file_input'];
const bindingScopes = new Set(['artist_identities', 'logos', 'playlists']);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => order(a, b)).map(([key, item]) => [key, canonical(item)]));
  return value === undefined ? null : value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const stamp = value => value ? new Date(value).toISOString() : null;
const date = value => stamp(value)?.slice(0, 10) ?? null;
const lower = value => value?.toLowerCase() ?? null;
const sorted = values => [...values].sort((a, b) => order(JSON.stringify(canonical(a)), JSON.stringify(canonical(b))));
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value[key] ?? null]));
const empty = () => Object.fromEntries(scopes.map(scope => [scope, []]));
const row = (key, value, observedAt = null, owned = false, invalid = false) => ({ key, value: canonical(value), observedAt: stamp(observedAt), owned, invalid });
const slug = name => encodeURIComponent(name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''));
const key = (...parts) => JSON.stringify(parts);

// A DB superset preserves every file value; arrays must retain order (and multiplicity).
export function preserves(expected, actual) {
  if (JSON.stringify(canonical(expected)) === JSON.stringify(canonical(actual))) return true;
  // Null represents an absent optional file field, so a DB value is additive.
  if (expected === null && actual !== undefined) return true;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    let position = 0;
    return expected.every(item => {
      while (position < actual.length && !preserves(item, actual[position])) position++;
      return position++ < actual.length;
    });
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    return Object.entries(expected).every(([field, value]) => Object.hasOwn(actual, field) && preserves(value, actual[field]));
  }
  return false;
}
export function comparePreservation(files, database, unavailable = []) {
  const report = {};
  let unresolved = 0;
  let review = 0;
  for (const scope of scopes) {
    const expected = files[scope] ?? [], actual = database[scope] ?? [];
    const counts = Object.fromEntries(categories.map(category => [category, 0]));
    counts.unavailable_file_input = unavailable.includes(scope) ? 1 : 0;
    const index = (rows, side) => {
      const map = new Map();
      for (const item of rows) {
        if (map.has(item.key)) counts[`duplicate_${side}`]++;
        if (item.invalid) counts[`invalid_${side}`]++;
        map.set(item.key, item);
      }
      return map;
    };
    const left = index(expected, 'file'), right = index(actual, 'db');
    const lineupAddition = (file, db) => {
      const edition = JSON.parse(file.key)[0];
      const group = values => [...values.values()].filter(item => JSON.parse(item.key)[0] === edition && item.value.billing === file.value.billing).sort((a, b) => a.value.position - b.value.position);
      const original = group(left), current = group(right);
      const originalKeys = new Set(original.map(item => item.key));
      const kept = current.filter(item => originalKeys.has(item.key));
      return current.length > original.length && digest(kept.map(item => item.key)) === digest(original.map(item => item.key)) &&
        new Set(current.map(item => item.value.position)).size === current.length &&
        current.every(item => Number.isInteger(item.value.position) && item.value.position >= 0) &&
        preserves(file.value, { ...db.value, position: file.value.position });
    };
    for (const [naturalKey, file] of left) {
      const db = right.get(naturalKey);
      if (!db) { counts.missing_in_db++; continue; }
      const newer = db.observedAt && file.observedAt && Date.parse(db.observedAt) > Date.parse(file.observedAt);
      if (digest(file.value) === digest(db.value)) counts[newer ? 'newer_db_same' : 'equal']++;
      else if (preserves(file.value, db.value) || (scope === 'lineup' && lineupAddition(file, db))) counts.preserved_with_db_additions++;
      else if (bindingScopes.has(scope) && file.value.binding !== db.value.binding) counts.binding_changed++;
      else counts[newer ? 'newer_db_changed' : db.owned ? 'db_owned_changed' : 'changed']++;
    }
    for (const naturalKey of right.keys()) if (!left.has(naturalKey)) counts.db_only++;
    // Newer observations are review evidence, never automatic proof of preservation.
    review += counts.newer_db_changed + counts.db_owned_changed;
    unresolved += counts.missing_in_db + counts.changed + counts.binding_changed + counts.invalid_file + counts.invalid_db + counts.duplicate_file + counts.duplicate_db + counts.unavailable_file_input;
    const hashRows = rows => digest(sorted(rows.map(({ key: naturalKey, value, observedAt, invalid }) => ({ key: naturalKey, value, observedAt, invalid }))));
    report[scope] = { fileCount: expected.length, dbCount: actual.length, fileHash: hashRows(expected), dbHash: hashRows(actual), categories: counts };
  }
  return { version: 1, unresolvedCount: unresolved, reviewCount: review, fileHash: digest(Object.fromEntries(Object.entries(report).map(([scope, value]) => [scope, value.fileHash]))), dbHash: digest(Object.fromEntries(Object.entries(report).map(([scope, value]) => [scope, value.dbHash]))), scopes: report, reportHash: digest(report) };
}

// Shared projection of effective file catalogue and all DB editions/artists, including archives.
export function projectCatalog(catalog) {
  const output = empty();
  for (const [catalogOrder, festival] of catalog.festivals.entries()) output.festivals.push(row(festival.slug, {
    catalogOrder: festival.catalogOrder ?? catalogOrder,
    ...pick(festival, ['name', 'country', 'countryCode', 'city', 'officialUrl']),
    coordinates: festival.coordinates ?? null, genres: sorted(festival.genres),
  }));
  for (const edition of catalog.editions) {
    const editionKey = key(edition.slug, edition.editionYear);
    output.editions.push(row(editionKey, {
      ...pick(edition, ['startDate', 'endDate', 'dateLabel', 'status', 'ticketStatus', 'ticketsUrl', 'recordState', 'completeness']), snapshotAt: stamp(edition.snapshotAt),
    }, edition.updatedAt));
    for (const source of edition.provenance ?? []) output.edition_provenance.push(row(key(editionKey, source.field, source.url, stamp(source.checkedAt)), { ...source, checkedAt: stamp(source.checkedAt) }));
    for (const billing of ['headliners', 'lineup']) (edition[billing] ?? []).forEach((name, position) => {
      output.lineup.push(row(key(editionKey, slug(name)), { name, billing, position, status: 'announced' }, edition.updatedAt));
    });
    for (const performance of edition.timetable ?? []) output.timetable.push(row(key(editionKey, performance.date, performance.stage, performance.start, performance.artist), {
      ...pick(performance, ['date', 'stage', 'start', 'artist', 'timeZone', 'sourceUrl']), artistBinding: Object.hasOwn(performance, 'artistBinding') ? performance.artistBinding : catalog.artists.some(artist => artist.slug === slug(performance.artist)) ? slug(performance.artist) : null, status: performance.status === 'cancelled' ? 'cancelled' : 'announced',
    }, performance.observedAt));
  }
  for (const artist of catalog.artists) {
    const observedAt = artist.freshness?.profile?.checkedAt;
    output.artists.push(row(artist.slug, {
      ...pick(artist, ['name', 'origin', 'biography', 'image', 'identityState', 'freshness']),
      aliases: sorted(artist.aliases), genres: sorted(artist.genres), topTracks: artist.topTracks, recentSetlists: artist.recentSetlists,
    }, observedAt));
    for (const [provider, binding] of Object.entries(artist.identities)) if (binding) output.artist_identities.push(row(key(artist.slug, provider), { binding }, observedAt));
    for (const link of artist.links) output.artist_links.push(row(key(artist.slug, link.url), link, observedAt));
    for (const source of artist.provenance) output.artist_provenance.push(row(key(artist.slug, source.field, source.source, source.url, date(source.checkedAt)), { ...source, checkedAt: date(source.checkedAt) }));
  }
  return output;
}
export function projectOperational(output, enrichment, identity, cache = {}, owned = false) {
  const document = enrichment?.result ?? enrichment;
  for (const [artist, profile] of Object.entries(document?.profiles ?? {})) output.enrichment_profiles.push(row(artist, profile, document.generatedAt, owned));
  for (const item of document?.manualReview ?? []) output.enrichment_review.push(row(key(item.slug ?? item.name, item.reason), item, document.generatedAt, owned));
  for (const [cacheKey, value] of Object.entries(cache)) output.enrichment_cache.push(row(cacheKey, value, null, owned));
  for (const [artist, value] of Object.entries(identity?.artists ?? {})) output.identity_state.push(row(artist, value, identity.updatedAt, owned));
}
function projectSources(output, sources, parserKey, database = false) {
  const cadence = { daily: 86400, every_3_days: 259200, weekly: 604800, archived: 2592000 };
  for (const source of sources) output.sources.push(row(key(source.festivalSlug, source.url), {
    ...pick(source, ['url', 'strategies', 'refreshPolicy', 'enabled', 'editionYear', 'manualReviewReason', 'fetchUrl', 'followLinkPattern']),
    headers: (database ? source.requestHeaders : source.headers) ?? null,
    parserKey: database ? source.parserKey : parserKey(source),
    cadenceSeconds: database ? source.cadenceSeconds : cadence[source.refreshPolicy],
    festivalBinding: database ? source.festival?.slug ?? null : source.festivalBinding,
    editionBinding: database ? source.edition ? key(source.edition.festival.slug, source.edition.year) : null : source.editionBinding,
  }, null, database && Boolean(source.configurationBackfilledAt), database && source.enabled && (!source.festival || source.festival.slug !== source.festivalSlug || !source.edition || source.edition.festivalId !== source.festivalId || source.edition.year !== source.editionYear || source.edition.festival.slug !== source.festivalSlug)));
}

export async function readDatabaseSnapshot(client) {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '45s'");
    const festivals = await tx.festival.findMany();
    const editions = await tx.festivalEdition.findMany({ include: { festival: true, lineup: { include: { artist: true } }, provenance: true, timetable: { include: { artist: true } }, playlists: true } });
    const artists = await tx.artist.findMany({ include: { identities: true, links: true, provenance: true } });
    const sources = await tx.festivalSource.findMany({ include: { festival: true, edition: { include: { festival: true } } } });
    const logos = await tx.festivalLogo.findMany({ include: { festival: true, asset: true } });
    const operational = await tx.operationalState.findMany({ where: { key: { in: ['artist-enrichment', 'artist-identities'] } }, select: { key: true, payload: true } });
    return { festivals, editions, artists, sources, logos, operational };
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
}
export function projectDatabase(snapshot) {
  const festivalShape = festival => ({ ...festival, coordinates: festival.latitude === null || festival.longitude === null ? null : { latitude: festival.latitude, longitude: festival.longitude } });
  const output = projectCatalog({
    festivals: snapshot.festivals.map(festivalShape),
    editions: snapshot.editions.map(edition => ({ ...edition, slug: edition.festival.slug, editionYear: edition.year, startDate: date(edition.startDate), endDate: date(edition.endDate), status: lower(edition.status), ticketStatus: lower(edition.ticketStatus), recordState: lower(edition.recordState), completeness: lower(edition.completeness), updatedAt: edition.sourceUpdatedAt,
      headliners: edition.lineup.filter(item => item.billing === 'HEADLINER').sort((a, b) => a.position - b.position).map(item => item.artist.name),
      lineup: edition.lineup.filter(item => item.billing === 'LINEUP').sort((a, b) => a.position - b.position).map(item => item.artist.name),
      timetable: edition.timetable.map(item => ({ ...item, date: date(item.date), artist: item.artistName, artistBinding: item.artist?.slug ?? null, status: lower(item.status) })),
    })),
    artists: snapshot.artists.map(artist => ({ ...artist, identityState: lower(artist.identityState), image: artist.imageUrl ? { url: artist.imageUrl, alt: artist.imageAlt, width: artist.imageWidth, height: artist.imageHeight } : null,
      identities: Object.fromEntries(artist.identities.map(item => [item.provider, item.externalId])),
      links: artist.links.map(item => pick(item, ['label', 'url', 'source', 'verified'])),
      provenance: artist.provenance.map(item => pick(item, ['field', 'source', 'url', 'checkedAt'])),
    })),
  });
  // Keep raw billing positions and cancelled entries: UI projections conceal these.
  output.lineup = snapshot.editions.flatMap(edition => edition.lineup.map(item => row(key(key(edition.festival.slug, edition.year), item.artist.slug), { name: item.artist.name, billing: item.billing === 'HEADLINER' ? 'headliners' : 'lineup', position: item.position, status: lower(item.status) }, edition.sourceUpdatedAt)));
  output.edition_provenance = snapshot.editions.flatMap(edition => edition.provenance.map(item => row(key(key(edition.festival.slug, edition.year), item.field, item.url, stamp(item.checkedAt)), { ...pick(item, ['field', 'url', 'note']), checkedAt: stamp(item.checkedAt) })));
  projectSources(output, snapshot.sources, null, true);
  for (const edition of snapshot.editions) for (const playlist of edition.playlists) output.playlists.push(row(key(edition.festival.slug, edition.year, playlist.provider), { binding: playlist.url, artists: playlist.artistCount, tracks: playlist.trackCount }, playlist.syncedAt));
  for (const logo of snapshot.logos) {
    const bytes = Buffer.from(logo.asset.bytes);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    output.logos.push(row(logo.festival.slug, { binding: logo.assetHash, mimeType: logo.asset.mimeType, sizeBytes: logo.asset.sizeBytes }, null, true, actualHash !== logo.assetHash || logo.asset.sha256 !== logo.assetHash || bytes.length !== logo.asset.sizeBytes));
  }
  const state = Object.fromEntries(snapshot.operational.map(item => [item.key, item.payload]));
  projectOperational(output, state['artist-enrichment'], state['artist-identities'], state['artist-enrichment']?.cache, true);
  const enrichment = state['artist-enrichment'];
  const document = enrichment?.result ?? enrichment;
  if (enrichment && (!document.profiles || !Array.isArray(document.manualReview))) output.enrichment_profiles.push(row('invalid', null, null, true, true));
  const identity = state['artist-identities'];
  if (identity && (identity.schemaVersion !== 1 || !identity.artists)) output.identity_state.push(row('invalid', null, null, true, true));
  return output;
}

// Private shared state supersedes the packaged playlist snapshot when explicitly supplied.
export function projectPlaylistState(state, editions) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const invalid = value => row(digest(value), null, null, false, true);
  if (!record(state) || !Object.keys(state).length) return [invalid(state)];
  const allowed = new Set(['spotifyUrl', 'youtubeMusicUrl', 'artists', 'tracks', 'updatedAt']);
  const validUrl = value => {
    if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
    try { const parsed = new URL(value); return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password; } catch { return false; }
  };
  const output = [];
  for (const [festivalSlug, status] of Object.entries(state)) {
    const current = editions.filter(edition => edition.slug === festivalSlug && edition.recordState === 'current');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(festivalSlug) || !record(status) || Object.keys(status).some(field => !allowed.has(field)) ||
        !Number.isSafeInteger(status.artists) || status.artists < 0 || !Number.isSafeInteger(status.tracks) || status.tracks < 0 ||
        typeof status.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(status.updatedAt) || !Number.isFinite(Date.parse(status.updatedAt)) ||
        (!Object.hasOwn(status, 'spotifyUrl') && !Object.hasOwn(status, 'youtubeMusicUrl')) ||
        ['spotifyUrl', 'youtubeMusicUrl'].some(field => Object.hasOwn(status, field) && !validUrl(status[field])) || current.length !== 1) {
      output.push(invalid({ festivalSlug, status }));
      continue;
    }
    for (const [provider, binding] of [['spotify', status.spotifyUrl], ['youtube_music', status.youtubeMusicUrl]]) if (binding) output.push(row(key(festivalSlug, current[0].editionYear, provider), { binding, artists: status.artists, tracks: status.tracks }, status.updatedAt));
  }
  return output;
}

export async function readFiles(root, identityPath, playlistPath) {
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const { catalogSeed } = await import(pathToFileURL(resolve(root, 'lib/catalog/seed.ts')).href);
  const { festivalSources } = await import(pathToFileURL(resolve(root, 'data/festival-sources.ts')).href);
  const { sourceParserKey } = await import(pathToFileURL(resolve(root, 'lib/sources/repository.ts')).href);
  const output = projectCatalog(catalogSeed);
  const unavailable = [];
  projectSources(output, festivalSources.map(source => ({ ...source,
    festivalBinding: catalogSeed.festivals.some(festival => festival.slug === source.festivalSlug) ? source.festivalSlug : null,
    editionBinding: catalogSeed.editions.some(edition => edition.slug === source.festivalSlug && edition.editionYear === source.editionYear) ? key(source.festivalSlug, source.editionYear) : null,
  })), sourceParserKey);
  if (playlistPath) {
    let bytes;
    try { bytes = await readFile(playlistPath, 'utf8'); } catch { unavailable.push('playlists'); }
    if (bytes !== undefined) {
      try { output.playlists = projectPlaylistState(JSON.parse(bytes), catalogSeed.editions); }
      catch { output.playlists = [row('invalid_playlist_input', null, null, false, true)]; }
    }
  } else output.playlists = projectPlaylistState(catalogSeed.playlists, catalogSeed.editions);
  const inventory = await json(resolve(root, 'data/reviewed-logo-inventory.json'));
  for (const logo of inventory) {
    if (basename(logo.file) !== logo.file) throw new Error('invalid_file_input');
    const bytes = await readFile(resolve(root, 'public/logos', logo.file));
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    output.logos.push(row(logo.slug, { binding: actualHash, mimeType: logo.mimeType, sizeBytes: bytes.length }, null, false, actualHash !== logo.sha256 || bytes.length !== logo.sizeBytes));
  }
  const listed = new Set(inventory.map(item => item.file));
  for (const filename of await readdir(resolve(root, 'public/logos'))) if (!listed.has(filename) && /\.(png|jpe?g|webp|gif|svg)$/i.test(filename)) output.logos.push(row(digest(filename), null, null, false, true));
  const timetable = await json(resolve(root, 'data/timetables.json'));
  if (timetable.schemaVersion !== 1 || !timetable.festivals || Array.isArray(timetable.festivals)) throw new Error('invalid_file_input');
  for (const festivalSlug of Object.keys(timetable.festivals)) if (!catalogSeed.editions.some(edition => edition.slug === festivalSlug && edition.timetable?.length)) output.timetable.push(row(digest(festivalSlug), null, null, false, true));
  const enrichment = await json(resolve(root, 'data/artist-enrichment.json'));
  const identity = identityPath ? await json(identityPath) : null;
  if (!identity) unavailable.push('identity_state');
  if (identity && (identity.schemaVersion !== 1 || !identity.artists)) throw new Error('invalid_file_input');
  if (enrichment.schemaVersion !== 1 || !enrichment.profiles || !Array.isArray(enrichment.manualReview)) throw new Error('invalid_file_input');
  projectOperational(output, enrichment, identity);
  return { output, unavailable };
}

export async function runAudit(client, root, identityPath, playlistPath) {
  const files = await readFiles(root, identityPath, playlistPath);
  const database = projectDatabase(await readDatabaseSnapshot(client));
  return comparePreservation(files.output, database, files.unavailable);
}
export async function auditCommand({ environment = process.env, args = process.argv.slice(2), emit = (value, failure) => (failure ? console.error : console.log)(JSON.stringify(value)), openClient = async () => { const { PrismaClient } = await import('@prisma/client'); return new PrismaClient({ log: [] }); } } = {}) {
  let client;
  let exitCode = 0;
  try {
    if (!environment.DATABASE_URL) throw new Error('missing_database');
    if (args.some(arg => !arg.startsWith('--release-root=') && !arg.startsWith('--identity-state=') && !arg.startsWith('--playlist-state='))) throw new Error('invalid_argument');
    for (const name of ['release-root', 'identity-state', 'playlist-state']) if (args.filter(arg => arg.startsWith(`--${name}=`)).length > 1 || args.includes(`--${name}=`)) throw new Error('invalid_argument');
    const argument = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const root = resolve(argument('release-root') ?? dirname(dirname(fileURLToPath(import.meta.url))));
    client = await openClient();
    const report = await runAudit(client, root, argument('identity-state'), argument('playlist-state'));
    emit(report, false);
    if (report.unresolvedCount || report.reviewCount) exitCode = 2;
  } catch {
    emit({ categories: { audit_failed: 1 } }, true);
    exitCode = 1;
  } finally {
    if (client) try { await client.$disconnect(); } catch { exitCode = 1; }
  }
  return exitCode;
}
if (process.argv[1] && await realpath(process.argv[1]).catch(() => '') === fileURLToPath(import.meta.url)) process.exitCode = await auditCommand();
