import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { claimPlaylistRefresh, assertPlaylistRefreshLease, renewPlaylistRefreshLease, finishPlaylistRefresh, commitPlaylistRefresh, type PlaylistLease } from './playlist-queue.ts';

export type PlaylistResult = { url: string; artists: number; tracks: number };
export type PlaylistExecutor = (claim: PlaylistLease, guard: () => Promise<void>, signal: AbortSignal) => Promise<PlaylistResult>;

/** One bounded scan/attempt. Provider implementation must guard every write and read back. */
export async function runPlaylistWorker(db: PrismaClient, execute: PlaylistExecutor) {
  const owner = randomUUID();
  let cursor = null;
  let claim: PlaylistLease | null = null;
  for (let page = 0; page < 64; page++) {
    const result = await claimPlaylistRefresh(db, { owner, ttlMs: 120_000, cursor });
    claim = result.claim;
    cursor = result.nextCursor;
    if (claim || !cursor) break;
  }
  if (!claim) return { status: cursor ? 'SCAN_LIMIT' : 'IDLE' };
  const active = claim;
  const abort = new AbortController();
  let renewal: Promise<void> = Promise.resolve();
  let lost: unknown;
  const timer = setInterval(() => {
    renewal = renewal.then(async () => {
      if (lost) return;
      try { await renewPlaylistRefreshLease(db, active, 120_000); }
      catch (error) { lost = error; abort.abort(); }
    });
  }, 30_000);
  const guard = async () => {
    if (lost) throw lost;
    await assertPlaylistRefreshLease(db, active);
  };
  try {
    await guard();
    const result = await execute(active, guard, abort.signal);
    await guard();
    if (!/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/.test(result.url)
      || !Number.isSafeInteger(result.tracks) || result.tracks < 1
      || !Number.isSafeInteger(result.artists) || result.artists < 1) throw new Error('Invalid provider read-back');
    await commitPlaylistRefresh(db, active, async (tx, scope) => {
      const edition = await tx.festivalEdition.findFirstOrThrow({ where: { festival: { slug: scope.festivalSlug }, year: scope.editionYear }, select: { id: true } });
      const current = await tx.festivalPlaylist.findUniqueOrThrow({ where: { editionId_provider: { editionId: edition.id, provider: 'spotify' } } });
      if (current.url !== result.url) throw new Error('Playlist binding changed during refresh');
      await tx.festivalPlaylist.update({ where: { id: current.id }, data: { artistCount: result.artists, trackCount: result.tracks, syncedAt: new Date() } });
    });
    return { status: 'SUCCEEDED' };
  } catch (error) {
    abort.abort();
    await finishPlaylistRefresh(db, active, 'FAILED');
    throw error;
  } finally {
    clearInterval(timer);
    await renewal;
  }
}
