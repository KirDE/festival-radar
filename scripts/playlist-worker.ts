import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readPlaylistMode } from '../lib/catalog/playlist-cutover.ts';
import { acquirePlaylistProcessLock } from '../lib/catalog/playlist-process-lock.ts';
import { db } from '../lib/db.ts';
import { readCatalog } from '../lib/catalog/repository.ts';
import { stagePlaylistPlan } from '../lib/catalog/playlist-queue.ts';
import { runPlaylistWorker } from '../lib/catalog/playlist-worker.ts';
const execute = promisify(execFile);
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
    const creating = playlistUrl === '' || playlistUrl === 'NEW';
    if (!festival || (!creating && !/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/.test(playlistUrl))) throw new Error('Current edition and valid DB playlist binding required');
    const directory = await mkdtemp(path.join(process.env.PLAYLIST_WORK_DIRECTORY ?? '/tmp', 'festival-playlist-'));
    try {
      await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ season: festival.editionYear, festivals: [{ ...festival, artists: [...festival.headliners, ...festival.lineup], playlistUrl: creating ? '' : playlistUrl }] }), { mode: 0o600 });
      const env = { ...process.env, FESTIVAL_CATALOG: path.join(directory, 'catalog.json'), FESTIVAL_REPORT_ONLY: '1', FESTIVALS: festival.slug };
      const reportPath = path.join(directory, 'outputs/festival_playlists', festival.slug + '.json');
      const [queued] = await db.$queryRaw<{ desiredPlan: import('@prisma/client').Prisma.JsonValue | null }[]>`SELECT "desiredPlan" FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id}`;
      let plan: unknown = queued.desiredPlan;
      if (plan === null) {
        await execute(process.env.PLAYLIST_PYTHON ?? 'python3', [path.join(root, 'scripts/spotify_gmm_2026/festival_playlists.py')], { cwd: directory, env, signal, timeout: 6_000_000, maxBuffer: 1024 * 1024 });
        plan = await stagePlaylistPlan(db, claim, JSON.parse(await readFile(reportPath, 'utf8')));
      }
      const candidate = plan as { playlist_url?: string; edition_year?: number };
      if (candidate.playlist_url !== (creating ? '' : playlistUrl) || candidate.edition_year !== publication.editionYear) throw new Error('Durable plan binding mismatch');
      await guard();
      // apply accepts an explicit plan path; it does not need the report directory.
      const planPath = path.join(directory, 'plan.json');
      await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
      await execute(process.env.PLAYLIST_PYTHON ?? 'python3', [path.join(root, 'scripts/spotify_gmm_2026/apply_playlist_plan.py'), planPath], {
        cwd: directory, env: { ...env, PLAYLIST_LEASE: JSON.stringify(claim), PLAYLIST_EXPECTED_URL: playlistUrl, PLAYLIST_GUARD_NODE: process.execPath, PLAYLIST_GUARD_SCRIPT: path.join(root, 'scripts/playlist-lease-guard.ts') },
        signal, timeout: 600_000, maxBuffer: 1024 * 1024,
      });
      const report = JSON.parse(await readFile(planPath, 'utf8'));
      return { url: report.playlist_url, artists: report.artists_count, tracks: report.track_count, expectedUrl: playlistUrl };
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  console.log(JSON.stringify(result));
} catch { console.error('playlist_worker_failed'); process.exitCode = 1; }
finally { await release?.(); await db.$disconnect(); }
