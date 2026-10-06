import { Prisma, type PrismaClient } from '@prisma/client';
import { withPlaylistRefreshLease, type PlaylistLease } from './playlist-queue.ts';

export const YOUTUBE_URL = /^https:\/\/(?:music|www)\.youtube\.com\/playlist\?list=([A-Za-z0-9_-]{10,100})$/;
const playlistIdPattern = /^[A-Za-z0-9_-]{10,100}$/;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
export type YoutubePlan = { slug: string; editionYear: number; expectedUrl: string; title: string; description: string; videoIds: string[]; artists: number; sourceTracks: number };
export type YoutubeInsert = { playlistId: string; expectedIds: string[] };
export type YoutubeMetadata = { playlistId: string; title: string; description: string };
export type YoutubeState = { marker: string; sent: boolean; playlistId: string | null; creationMetadata: { title: string; description: string } | null; pendingInsert: YoutubeInsert | null; pendingMetadata: YoutubeMetadata | null };
export type YoutubeProgress = { verifiedTracks: number; totalTracks: number; quotaUsed: number; complete: boolean };

export function validateYoutubePlan(value: unknown): asserts value is YoutubePlan {
  const plan = value as YoutubePlan | null;
  if (!plan || typeof plan.slug !== 'string' || !plan.slug || !Number.isSafeInteger(plan.editionYear)
    || typeof plan.expectedUrl !== 'string' || (!['', 'NEW'].includes(plan.expectedUrl) && !YOUTUBE_URL.test(plan.expectedUrl))
    || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 150
    || typeof plan.description !== 'string' || plan.description.length > 4000
    || !Array.isArray(plan.videoIds) || !plan.videoIds.length || plan.videoIds.length > 1000
    || plan.videoIds.some(id => typeof id !== 'string' || !videoIdPattern.test(id)) || new Set(plan.videoIds).size !== plan.videoIds.length
    || !Number.isSafeInteger(plan.artists) || plan.artists < 1
    || !Number.isSafeInteger(plan.sourceTracks) || plan.sourceTracks < plan.videoIds.length) throw new Error('Invalid YouTube plan');
}

async function providerScope(tx: Prisma.TransactionClient, claim: PlaylistLease, expectedUrl: string) {
  if (!['', 'NEW'].includes(expectedUrl) && !YOUTUBE_URL.test(expectedUrl)) throw new Error('Invalid YouTube binding');
  const publication = await tx.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId } });
  const edition = await tx.festivalEdition.findFirstOrThrow({ where: { year: publication.editionYear, recordState: 'CURRENT', festival: { slug: claim.festivalSlug } }, select: { id: true } });
  const binding = await tx.festivalPlaylist.findUnique({ where: { editionId_provider: { editionId: edition.id, provider: 'youtube_music' } } });
  if ((binding?.url ?? '') !== expectedUrl) throw new Error('YouTube binding changed');
  if (await tx.catalogPlaylistRefresh.count({ where: { festivalSlug: claim.festivalSlug, status: 'SUCCEEDED', publication: { createdAt: { gt: publication.createdAt } } } })) throw new Error('Newer playlist publication completed');
  return publication;
}

export async function stageYoutubePlan(db: PrismaClient, claim: PlaylistLease, plan: unknown): Promise<YoutubePlan> {
  validateYoutubePlan(plan);
  return withPlaylistRefreshLease(db, claim, async tx => {
    const publication = await providerScope(tx, claim, plan.expectedUrl);
    if (plan.slug !== claim.festivalSlug || plan.editionYear !== publication.editionYear) throw new Error('YouTube plan scope mismatch');
    const [row] = await tx.$queryRaw<{ youtubePlan: unknown }[]>`SELECT "youtubePlan" FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id}`;
    if (row.youtubePlan !== null) { validateYoutubePlan(row.youtubePlan); return row.youtubePlan; }
    await tx.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "youtubePlan" = ${JSON.stringify(plan)}::jsonb WHERE id = ${claim.id}`;
    return plan;
  });
}

// One edition owns the creation and outstanding insert intents, even when the
// next attempt belongs to a different publication. Never overwrite an ambiguity.
export async function youtubeProviderState(
  db: PrismaClient, claim: PlaylistLease, expectedUrl: string,
  action: 'read' | 'reserve' | 'bind' | 'insert' | 'confirm' | 'metadata' | 'metadata-confirm', payload?: unknown,
): Promise<YoutubeState> {
  if (!['read', 'reserve', 'bind', 'insert', 'confirm', 'metadata', 'metadata-confirm'].includes(action)) throw new Error('Invalid YouTube state action');
  return withPlaylistRefreshLease(db, claim, async tx => {
    const publication = await providerScope(tx, claim, expectedUrl);
    const [job] = await tx.$queryRaw<{ youtubePlan: unknown }[]>`SELECT "youtubePlan" FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id}`;
    validateYoutubePlan(job.youtubePlan);
    const plan = job.youtubePlan;
    if (plan.slug !== claim.festivalSlug || plan.editionYear !== publication.editionYear || plan.expectedUrl !== expectedUrl) throw new Error('YouTube plan binding mismatch');
    const [row] = await tx.$queryRaw<{ id: string; youtubeState: YoutubeState }[]>`
      SELECT job.id, job."youtubeState" FROM "CatalogPlaylistRefresh" AS job
      JOIN "CatalogPublication" AS publication ON publication.id = job."publicationId"
      WHERE job."festivalSlug" = ${claim.festivalSlug} AND publication."editionYear" = ${publication.editionYear}
        AND publication."festivalSlug" = ${claim.festivalSlug} AND publication."lineupChanged" = true
        AND job."youtubeState" IS NOT NULL
      ORDER BY job."requestedAt", job.id LIMIT 1 FOR UPDATE OF job
    `;
    const state = row?.youtubeState ?? { marker: `festival-radar:youtube:${claim.id}`, sent: false, playlistId: null, creationMetadata: null, pendingInsert: null, pendingMetadata: null };
    const boundId = YOUTUBE_URL.exec(expectedUrl)?.[1] ?? state.playlistId;
    if (state.pendingInsert && boundId !== state.pendingInsert.playlistId) throw new Error('Unresolved YouTube insert belongs to another binding');
    if (state.pendingMetadata && boundId !== state.pendingMetadata.playlistId) throw new Error('Unresolved YouTube metadata belongs to another binding');
    if (action === 'reserve') {
      if (!['', 'NEW'].includes(expectedUrl) || state.sent || state.pendingInsert || state.pendingMetadata) throw new Error('YouTube creation already sent or bound; reconcile');
      const metadata = payload as { title?: string; description?: string } | null;
      if (!metadata || metadata.title !== plan.title || metadata.description !== `${plan.description}\n[${state.marker}]`) throw new Error('YouTube creation metadata mismatch');
      state.creationMetadata = { title: metadata.title, description: metadata.description };
      state.sent = true;
    } else if (action === 'bind') {
      if (!['', 'NEW'].includes(expectedUrl) || !state.sent || typeof payload !== 'string' || !playlistIdPattern.test(payload)
        || (state.playlistId && state.playlistId !== payload)) throw new Error('YouTube creation identity mismatch');
      state.playlistId = payload;
    } else if (action === 'metadata' || action === 'metadata-confirm') {
      const metadata = payload as YoutubeMetadata;
      if (!metadata || metadata.playlistId !== boundId || typeof metadata.title !== 'string' || typeof metadata.description !== 'string') throw new Error('Invalid YouTube metadata intent');
      if (action === 'metadata') {
        const description = ['', 'NEW'].includes(expectedUrl) ? `${plan.description}\n[${state.marker}]` : plan.description;
        if (state.pendingMetadata || state.pendingInsert || metadata.title !== plan.title || metadata.description !== description) throw new Error('YouTube metadata unresolved or mismatched');
        state.pendingMetadata = metadata;
      } else {
        if (!state.pendingMetadata || state.pendingMetadata.playlistId !== metadata.playlistId || state.pendingMetadata.title !== metadata.title || state.pendingMetadata.description !== metadata.description) throw new Error('YouTube metadata confirmation mismatch');
        state.pendingMetadata = null;
      }
    } else if (action === 'insert' || action === 'confirm') {
      const insert = payload as YoutubeInsert;
      if (!insert || insert.playlistId !== boundId || !playlistIdPattern.test(insert.playlistId)
        || !Array.isArray(insert.expectedIds) || !insert.expectedIds.length || insert.expectedIds.length > 1000
        || insert.expectedIds.some(id => typeof id !== 'string' || !videoIdPattern.test(id))
        || new Set(insert.expectedIds).size !== insert.expectedIds.length) throw new Error('Invalid YouTube insert intent');
      if (action === 'insert') {
        if (state.pendingInsert || state.pendingMetadata) throw new Error('YouTube insert unresolved; reconcile');
        if (JSON.stringify(insert.expectedIds) !== JSON.stringify(plan.videoIds.slice(0, insert.expectedIds.length))) throw new Error('YouTube insert does not match durable plan');
        state.pendingInsert = insert;
      } else {
        if (!state.pendingInsert || state.pendingInsert.playlistId !== insert.playlistId || JSON.stringify(state.pendingInsert.expectedIds) !== JSON.stringify(insert.expectedIds)) throw new Error('YouTube insert confirmation mismatch');
        state.pendingInsert = null;
      }
    }
    if (action !== 'read') await tx.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "youtubeState" = ${JSON.stringify(state)}::jsonb WHERE id = ${row?.id ?? claim.id} OR id = ${claim.id}`;
    return state;
  });
}

export async function saveYoutubeProgress(db: PrismaClient, claim: PlaylistLease, expectedUrl: string, progress: YoutubeProgress) {
  if (!progress || !Number.isSafeInteger(progress.verifiedTracks) || progress.verifiedTracks < 0
    || !Number.isSafeInteger(progress.totalTracks) || progress.totalTracks < 1 || progress.verifiedTracks > progress.totalTracks
    || !Number.isSafeInteger(progress.quotaUsed) || progress.quotaUsed < 0 || progress.quotaUsed > 5000
    || typeof progress.complete !== 'boolean' || (progress.complete && progress.verifiedTracks !== progress.totalTracks)) throw new Error('Invalid YouTube progress');
  return withPlaylistRefreshLease(db, claim, async tx => {
    await providerScope(tx, claim, expectedUrl);
    const [row] = await tx.$queryRaw<{ youtubePlan: unknown }[]>`SELECT "youtubePlan" FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id}`;
    validateYoutubePlan(row.youtubePlan);
    if (row.youtubePlan.videoIds.length !== progress.totalTracks) throw new Error('YouTube progress plan mismatch');
    await tx.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "youtubeProgress" = ${JSON.stringify(progress)}::jsonb WHERE id = ${claim.id}`;
  });
}
