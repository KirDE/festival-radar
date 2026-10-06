import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { claimPlaylistRefresh, assertPlaylistRefreshLease, renewPlaylistRefreshLease, finishPlaylistRefresh, commitPlaylistRefresh, type PlaylistLease } from './playlist-queue.ts';
import { YOUTUBE_URL, validateYoutubePlan, type YoutubeState, type YoutubeProgress } from './youtube-playlist-queue.ts';

export type ProviderPlaylistResult = { url: string; artists: number; tracks: number; expectedUrl?: string };
export type PlaylistResult = ProviderPlaylistResult & { youtubeMusic?: ProviderPlaylistResult };
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
    if (result.youtubeMusic && (!YOUTUBE_URL.test(result.youtubeMusic.url)
      || !Number.isSafeInteger(result.youtubeMusic.tracks) || result.youtubeMusic.tracks < 1
      || !Number.isSafeInteger(result.youtubeMusic.artists) || result.youtubeMusic.artists < 1)) throw new Error('Invalid YouTube read-back');
    await commitPlaylistRefresh(db, active, async (tx, scope) => {
      const edition = await tx.festivalEdition.findFirstOrThrow({ where: { festival: { slug: scope.festivalSlug }, year: scope.editionYear, recordState: 'CURRENT' }, select: { id: true } });
      const publication = await tx.catalogPublication.findUniqueOrThrow({ where: { id: scope.publicationId } });
      if (await tx.catalogPlaylistRefresh.count({ where: { festivalSlug: scope.festivalSlug, status: 'SUCCEEDED', publication: { createdAt: { gt: publication.createdAt } } } })) throw new Error('Newer playlist publication completed');
      if (result.youtubeMusic) {
        const youtube = result.youtubeMusic;
        const [row] = await tx.$queryRaw<{ youtubePlan: unknown; youtubeState: YoutubeState | null; youtubeProgress: YoutubeProgress | null }[]>`SELECT "youtubePlan", "youtubeState", "youtubeProgress" FROM "CatalogPlaylistRefresh" WHERE id = ${active.id}`;
        validateYoutubePlan(row.youtubePlan);
        if (row.youtubePlan.slug !== scope.festivalSlug || row.youtubePlan.editionYear !== scope.editionYear
          || row.youtubePlan.expectedUrl !== (youtube.expectedUrl ?? youtube.url)
          || youtube.tracks !== row.youtubePlan.videoIds.length || youtube.artists !== row.youtubePlan.artists
          || !row.youtubeProgress?.complete || row.youtubeProgress.verifiedTracks !== youtube.tracks
          || row.youtubeState?.pendingInsert || row.youtubeState?.pendingMetadata) throw new Error('Incomplete YouTube publication');
        if ((youtube.expectedUrl ?? youtube.url) !== youtube.url
          && (!['', 'NEW'].includes(youtube.expectedUrl ?? youtube.url) || !row.youtubeState?.sent
            || youtube.url !== `https://music.youtube.com/playlist?list=${row.youtubeState.playlistId}`)) throw new Error('Unverified YouTube creation');
      }
      const providers: [string, ProviderPlaylistResult][] = [['spotify', result]];
      if (result.youtubeMusic) providers.push(['youtube_music', result.youtubeMusic]);
      for (const [provider, output] of providers) {
        const current = await tx.festivalPlaylist.findUnique({ where: { editionId_provider: { editionId: edition.id, provider } } });
        const expected = output.expectedUrl ?? output.url;
        if ((current?.url ?? '') !== expected) throw new Error('Playlist binding changed during refresh');
        if (provider === 'spotify' && expected !== output.url) {
          const [state] = await tx.$queryRaw<{ playlistId: string | null }[]>`SELECT "spotifyCreation"->>'playlistId' AS "playlistId" FROM "CatalogPlaylistRefresh" WHERE id = ${active.id}`;
          if (!['', 'NEW'].includes(expected) || output.url !== `https://open.spotify.com/playlist/${state.playlistId}`) throw new Error('Unverified playlist creation');
        }
        const data = { url: output.url, artistCount: output.artists, trackCount: output.tracks, syncedAt: new Date() };
        if (current) {
          const updated = await tx.festivalPlaylist.updateMany({ where: { id: current.id, url: expected }, data });
          if (updated.count !== 1) throw new Error('Playlist binding changed during commit');
        } else {
          // A concurrent binding insertion must fail uniqueness, never overwrite it.
          await tx.festivalPlaylist.create({ data: { editionId: edition.id, provider, ...data } });
        }
      }
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
