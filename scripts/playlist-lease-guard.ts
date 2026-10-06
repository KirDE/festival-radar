import { db } from '../lib/db.ts';
import { renewPlaylistRefreshLease, spotifyCreationState } from '../lib/catalog/playlist-queue.ts';
import { youtubeProviderState, saveYoutubeProgress } from '../lib/catalog/youtube-playlist-queue.ts';
import { readPlaylistMode } from '../lib/catalog/playlist-cutover.ts';
import { acquirePlaylistProcessLock } from '../lib/catalog/playlist-process-lock.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

async function guardSpotify() {
  const claim = JSON.parse(process.env.PLAYLIST_LEASE ?? 'null');
  claim.leaseExpiresAt = new Date(claim.leaseExpiresAt);
  const renewed = await renewPlaylistRefreshLease(db, claim, 120_000);
  const publication = await db.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId }, select: { createdAt: true, editionYear: true } });
  const expectedUrl = process.env.PLAYLIST_EXPECTED_URL ?? '';
  const creating = ['', 'NEW'].includes(expectedUrl);
  const action = process.argv[2] ?? 'read';
  let state;
  if (creating) {
    // Includes edition, binding and newer-publication checks inside the fence.
    state = await spotifyCreationState(db, claim, action as 'read' | 'reserve' | 'bind', expectedUrl, process.argv[3]);
  } else {
    if (action !== 'read') throw new Error('Existing playlist cannot create');
    const binding = await db.festivalPlaylist.findFirst({ where: { provider: 'spotify', url: expectedUrl, edition: { year: publication.editionYear, recordState: 'CURRENT', festival: { slug: claim.festivalSlug } } } });
    if (!binding) throw new Error('Playlist binding changed');
  }
  const newer = await db.catalogPlaylistRefresh.count({ where: {
    festivalSlug: claim.festivalSlug, status: "SUCCEEDED",
    publication: { createdAt: { gt: publication.createdAt } },
  } });
  if (newer) throw new Error("A newer playlist publication already completed; stale plan requires reconciliation");
  const [stamp] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  if (renewed.leaseExpiresAt.getTime() - stamp.now.getTime() < 60_000) throw new Error('Insufficient request lifetime');
  if (process.argv[2]) console.log(JSON.stringify(state));
}

async function guardYoutube() {
  const claim = JSON.parse(process.env.PLAYLIST_LEASE ?? 'null');
  claim.leaseExpiresAt = new Date(claim.leaseExpiresAt);
  const renewed = await renewPlaylistRefreshLease(db, claim, 120_000);
  const [stamp] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  if (renewed.leaseExpiresAt.getTime() - stamp.now.getTime() < 60_000) throw new Error('Insufficient request lifetime');
  const expectedUrl = process.env.YOUTUBE_EXPECTED_URL ?? '';
  const action = process.argv[2] ?? 'read';
  let payload: unknown;
  if (['reserve', 'bind', 'insert', 'confirm', 'metadata', 'metadata-confirm', 'progress'].includes(action)) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (input.length > 32_000) throw new Error('Invalid provider checkpoint');
    }
    payload = JSON.parse(input);
  }
  if (action === 'progress') {
    await saveYoutubeProgress(db, claim, expectedUrl, payload as Parameters<typeof saveYoutubeProgress>[3]);
    console.log('{}');
  } else {
    const state = await youtubeProviderState(db, claim, expectedUrl, action as Parameters<typeof youtubeProviderState>[3], payload);
    if (process.argv[2]) console.log(JSON.stringify(state));
  }
}

async function runLegacyYoutube() {
  let release: (() => Promise<void>) | undefined;
  try {
    if (process.env.PLAYLIST_LOCK_HELD !== 'true') release = await acquirePlaylistProcessLock();
    if (await readPlaylistMode(db) === 'database') throw new Error('Use DB playlist dispatch');
    await promisify(execFile)(process.env.PLAYLIST_PYTHON ?? 'python3', [fileURLToPath(new URL('spotify_gmm_2026/youtube_music_transfer.py', import.meta.url)), ...process.argv.slice(3)], {
      env: { ...process.env, PLAYLIST_LOCK_HELD: 'true', YOUTUBE_LEGACY_LOCK_HELD: 'true' }, timeout: 600_000, maxBuffer: 1024 * 1024,
    });
    console.log(JSON.stringify({ status: 'SUCCEEDED' }));
  } finally { await release?.(); }
}

// Reuse the packaged entrypoint; no deployment/timer asset changes are needed.
try {
  if (process.argv[2] === '--legacy-youtube') await runLegacyYoutube();
  else if (process.env.PLAYLIST_PROVIDER === 'youtube_music') await guardYoutube();
  else await guardSpotify();
} catch {
  if (process.argv[2] === '--legacy-youtube') console.error('legacy_youtube_publication_refused_or_failed');
  process.exitCode = 1;
}
finally { await db.$disconnect(); }
