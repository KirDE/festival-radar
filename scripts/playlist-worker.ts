import path from 'node:path';
import { readPlaylistMode } from '../lib/catalog/playlist-cutover.ts';
import { acquirePlaylistProcessLock } from '../lib/catalog/playlist-process-lock.ts';
import { db } from '../lib/db.ts';
import { readCatalog } from '../lib/catalog/repository.ts';
import { stagePlaylistPlan } from '../lib/catalog/playlist-queue.ts';
import { runPlaylistWorker, publishSpotifyCheckpoint } from '../lib/catalog/playlist-worker.ts';
import { stageYoutubePlan, validateYoutubePlan, YOUTUBE_URL } from '../lib/catalog/youtube-playlist-queue.ts';
import { executePlaylistJson } from '../lib/catalog/python-playlist-rpc.ts';
// Activation requires explicit stop/drain/reconciliation of legacy consumers.
let release: (() => Promise<void>) | undefined;
const root = process.cwd();
try {
  if (process.env.PLAYLIST_LOCK_HELD !== 'true') release = await acquirePlaylistProcessLock();
  if (await readPlaylistMode(db) !== 'database') throw new Error('Validated DB playlist activation required');
  const result = await runPlaylistWorker(db, async (claim, guard, signal) => {
    const publication = await db.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId } });
    const snapshot = await readCatalog({ database: db });
    const festival = snapshot.festivals.find(item => item.slug === claim.festivalSlug && item.editionYear === publication.editionYear);
    const playlistUrl = snapshot.playlists[claim.festivalSlug]?.spotifyUrl ?? '';
    // Read this provider directly: catalog status omits editions without Spotify.
    // No legacy env/file mapping participates in DB worker publication.
    const youtubeBinding = await db.festivalPlaylist.findFirst({ where: { provider: 'youtube_music', edition: { year: publication.editionYear, recordState: 'CURRENT', festival: { slug: claim.festivalSlug } } }, select: { url: true } });
    const youtubeUrl = youtubeBinding?.url ?? '';
    if (!['', 'NEW'].includes(youtubeUrl) && !YOUTUBE_URL.test(youtubeUrl)) throw new Error('Invalid YouTube DB binding');
    const creating = playlistUrl === '' || playlistUrl === 'NEW';
    if (!festival || (!creating && !/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/.test(playlistUrl))) throw new Error('Current edition and valid DB playlist binding required');
    const env = { ...process.env, FESTIVAL_WORKER_STDIO: '1', FESTIVAL_REPORT_ONLY: '1', PYTHONDONTWRITEBYTECODE: '1', FESTIVALS: festival.slug };
    const execute = (operation: string, value: unknown, extraEnv: Partial<NodeJS.ProcessEnv> = {}, timeout = 600_000) => executePlaylistJson(
      process.env.PLAYLIST_PYTHON ?? 'python3', [path.join(root, 'scripts/spotify_gmm_2026/playlist_worker_rpc.py'), operation], value,
      { cwd: root, env: { ...env, ...extraEnv }, signal, timeout },
    );
    const [queued] = await db.$queryRaw<{ desiredPlan: import('@prisma/client').Prisma.JsonValue | null }[]>`SELECT "desiredPlan" FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id}`;
    let plan: unknown = queued.desiredPlan;
    if (plan === null) {
      const discovered = await execute('discover-spotify', { season: festival.editionYear, festivals: [{ ...festival, artists: [...festival.headliners, ...festival.lineup], playlistUrl: creating ? '' : playlistUrl }] }, {}, 6_000_000);
      plan = await stagePlaylistPlan(db, claim, discovered as import('@prisma/client').Prisma.InputJsonValue);
    }
    const candidate = plan as { playlist_url?: string; edition_year?: number };
    if (candidate.playlist_url !== (creating ? '' : playlistUrl) || candidate.edition_year !== publication.editionYear) throw new Error('Durable plan binding mismatch');
    await guard();
    const report = await execute('apply-spotify', plan, {
      PLAYLIST_PROVIDER: 'spotify', PLAYLIST_LEASE: JSON.stringify(claim), PLAYLIST_EXPECTED_URL: playlistUrl,
      PLAYLIST_GUARD_NODE: process.execPath, PLAYLIST_GUARD_SCRIPT: path.join(root, 'scripts/playlist-lease-guard.ts'),
    }) as { playlist_url: string; artists_count: number; track_count: number };
    const spotify = await publishSpotifyCheckpoint(db, claim, { url: report.playlist_url, artists: report.artists_count, tracks: report.track_count, expectedUrl: playlistUrl });
    const [youtubeJob] = await db.$queryRaw<{ youtubePlan: unknown }[]>`SELECT "youtubePlan" FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id}`;
    let youtubePlan = youtubeJob.youtubePlan;
    if (youtubePlan === null) {
      const discovered = await execute('discover-youtube', { sourceReport: plan, slug: claim.festivalSlug, editionYear: publication.editionYear, expectedUrl: youtubeUrl });
      youtubePlan = await stageYoutubePlan(db, claim, discovered);
    }
    validateYoutubePlan(youtubePlan);
    if (youtubePlan.expectedUrl !== youtubeUrl || youtubePlan.slug !== claim.festivalSlug || youtubePlan.editionYear !== publication.editionYear) throw new Error('Durable YouTube plan binding mismatch');
    const youtubeMusic = await execute('apply-youtube', youtubePlan, {
      PLAYLIST_PROVIDER: 'youtube_music', PLAYLIST_LEASE: JSON.stringify(claim), YOUTUBE_EXPECTED_URL: youtubeUrl,
      PLAYLIST_GUARD_NODE: process.execPath, YOUTUBE_GUARD_SCRIPT: path.join(root, 'scripts/playlist-lease-guard.ts'),
    }) as { url: string; expectedUrl: string; artists: number; tracks: number };
    return { ...spotify, youtubeMusic };
  });
  console.log(JSON.stringify(result));
} catch { console.error('playlist_worker_failed'); process.exitCode = 1; }
finally { await release?.(); await db.$disconnect(); }
