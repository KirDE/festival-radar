import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { claimPlaylistRefresh, assertPlaylistRefreshLease, renewPlaylistRefreshLease, finishPlaylistRefresh, commitPlaylistRefresh, withPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';
import { YOUTUBE_URL, validateYoutubePlan, type YoutubeState, type YoutubeProgress } from './youtube-playlist-queue.ts';

export type ProviderPlaylistResult = { url: string; artists: number; tracks: number; expectedUrl?: string };
export type PlaylistResult = ProviderPlaylistResult & { youtubeMusic?: ProviderPlaylistResult };
export type PlaylistExecutor = (claim: PlaylistLease, guard: () => Promise<void>, signal: AbortSignal) => Promise<PlaylistResult>;

/** Publish a fully read-back Spotify result even while YouTube awaits quota.
 * Keep the same durable track plan and verified creation ID on every retry.
 * This checkpoint never marks the two-provider job complete.
 */
export async function publishSpotifyCheckpoint(db: PrismaClient, claim: PlaylistLease, result: ProviderPlaylistResult): Promise<ProviderPlaylistResult> {
  if (!/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/.test(result.url)
    || !Number.isSafeInteger(result.tracks) || result.tracks < 1
    || !Number.isSafeInteger(result.artists) || result.artists < 1) throw new Error('Invalid Spotify read-back');
  return withPlaylistRefreshLease(db, claim, async tx => {
    const publication = await tx.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId } });
    const edition = await tx.festivalEdition.findFirstOrThrow({ where: { festival: { slug: claim.festivalSlug }, year: publication.editionYear, recordState: 'CURRENT' }, select: { id: true } });
    if (await tx.catalogPlaylistRefresh.count({ where: { festivalSlug: claim.festivalSlug, status: 'SUCCEEDED', publication: { createdAt: { gt: publication.createdAt } } } })) throw new Error('Newer playlist publication completed');
    const row = await tx.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id }, select: { desiredPlan: true, spotifyCreation: true } });
    const plan = row.desiredPlan as Record<string, Prisma.JsonValue> | null;
    const expected = result.expectedUrl ?? result.url;
    if (!plan || plan.edition_year !== publication.editionYear || plan.track_count !== result.tracks || plan.artists_count !== result.artists
      || !Array.isArray(plan.track_uris) || plan.track_uris.length !== result.tracks
      || plan.playlist_url !== (['', 'NEW'].includes(expected) ? '' : expected)) throw new Error('Spotify checkpoint plan mismatch');
    const current = await tx.festivalPlaylist.findUnique({ where: { editionId_provider: { editionId: edition.id, provider: 'spotify' } } });
    if ((current?.url ?? '') !== expected) throw new Error('Playlist binding changed during checkpoint');
    if (expected !== result.url) {
      const creation = row.spotifyCreation as { sent?: boolean; playlistId?: string } | null;
      if (!['', 'NEW'].includes(expected) || !creation?.sent || result.url !== `https://open.spotify.com/playlist/${creation.playlistId}`) throw new Error('Unverified Spotify checkpoint creation');
    }
    const data = { url: result.url, artistCount: result.artists, trackCount: result.tracks, syncedAt: new Date() };
    if (current) {
      const updated = await tx.festivalPlaylist.updateMany({ where: { id: current.id, url: expected }, data });
      if (updated.count !== 1) throw new Error('Playlist binding changed during checkpoint');
    } else await tx.festivalPlaylist.create({ data: { editionId: edition.id, provider: 'spotify', ...data } });
    // Only normalize binding metadata after the provider read-back. Track URIs,
    // artist choices and the YouTube plan remain exactly as originally staged.
    await tx.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { desiredPlan: { ...plan, playlist_url: result.url, playlist_id: result.url.split('/').at(-1)! } } });
    return { ...result, expectedUrl: result.url };
  });
}

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
