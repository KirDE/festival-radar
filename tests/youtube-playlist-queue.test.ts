import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { PlaylistLeaseLostError, type PlaylistLease } from '../lib/catalog/playlist-queue.ts';
import { saveYoutubeProgress, stageYoutubePlan, validateYoutubePlan, youtubeProviderState, type YoutubePlan, type YoutubeState } from '../lib/catalog/youtube-playlist-queue.ts';

const playlistId = 'PLsynthetic001';
const url = `https://music.youtube.com/playlist?list=${playlistId}`;
const plan: YoutubePlan = { slug: 'synthetic', editionYear: 2027, expectedUrl: '', title: 'Festival', description: 'Description', videoIds: ['00000000001', '00000000002'], artists: 1, sourceTracks: 2 };
const lease: PlaylistLease = { id: 'job', publicationId: 'publication', festivalSlug: 'synthetic', attempts: 1, leaseOwner: randomUUID(), leaseExpiresAt: new Date() };

function fixture() {
  let plans = new Map<string, unknown>();
  let states = new Map<string, YoutubeState>();
  let progress = new Map<string, unknown>();
  let binding = '';
  let expireOnWrite = false;
  let newer = false;
  let archives: unknown = null;
  const db = { async $transaction(callback: (tx: unknown) => Promise<unknown>) {
    const nextPlans = structuredClone(plans), nextStates = structuredClone(states), nextProgress = structuredClone(progress);
    let expired = false;
    const tx = {
      async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        const sql = strings.join('?');
        if (sql.includes('SELECT "youtubePlan"')) return [{ youtubePlan: nextPlans.get(values[0] as string) ?? null }];
        if (sql.includes('job."youtubeState"')) {
          const row = nextStates.entries().next().value;
          return row ? [{ id: row[0], youtubeState: structuredClone(row[1]) }] : [];
        }
        if (sql.includes("job.status = 'RUNNING'")) return expired ? [] : [{ id: 'job' }];
        return [{ id: 'job' }];
      },
      async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        const sql = strings.join('?');
        if (sql.includes('SET "youtubePlan"')) nextPlans.set(values[1] as string, JSON.parse(values[0] as string));
        if (sql.includes('SET "youtubeState"')) {
          const state = JSON.parse(values[0] as string);
          nextStates.set(values[1] as string, state);
          nextStates.set(values[2] as string, structuredClone(state));
        }
        if (sql.includes('SET "youtubeProgress"')) nextProgress.set(values[1] as string, JSON.parse(values[0] as string));
        if (sql.includes('UPDATE')) expired = expireOnWrite;
        return 1;
      },
      catalogPublication: { async findUniqueOrThrow() { return { editionYear: 2027, createdAt: new Date() }; } },
      festivalEdition: { async findFirstOrThrow() { return { id: 'edition' }; } },
      festivalPlaylist: { async findUnique() { return binding ? { url: binding } : null; } },
      catalogPlaylistRefresh: { async count() { return newer ? 1 : 0; } },
      operationalState: { async findUnique() { return archives === null ? null : { payload: archives }; } },
    };
    const result = await callback(tx);
    plans = nextPlans; states = nextStates; progress = nextProgress;
    return result;
  } } as unknown as PrismaClient;
  return { db, archives(value: unknown) { archives = value; }, expire(value: boolean) { expireOnWrite = value; }, binding(value: string) { binding = value; }, newer() { newer = true; }, plans: () => plans, progress: () => progress };
}

test('immutable archive registry blocks renamed bound, adopted and inherited identities', async () => {
  const state = fixture();
  await stageYoutubePlan(state.db, lease, plan);
  state.archives({ youtube_music: [playlistId] });
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'adopt', { playlistId, title: plan.title, description: plan.description }), /Archived YouTube/);
  state.archives(null);
  await youtubeProviderState(state.db, lease, '', 'adopt', { playlistId, title: plan.title, description: plan.description });
  state.archives({ youtube_music: [playlistId] });
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'read'), /Archived YouTube/);
  const bound = fixture();
  bound.binding(url);
  await stageYoutubePlan(bound.db, lease, { ...plan, expectedUrl: url });
  bound.archives({ youtube_music: [playlistId] });
  await assert.rejects(youtubeProviderState(bound.db, lease, url, 'read'), /Archived YouTube/);
});

test('YouTube plans reject unsafe IDs, duplicates, bindings and counts', () => {
  for (const change of [{ videoIds: [] }, { videoIds: ['invalid'] }, { videoIds: ['00000000001', '00000000001'] }, { expectedUrl: 'http://youtube.com/playlist?list=PLsynthetic001' }, { artists: 0 }, { sourceTracks: 1 }, { title: '' }]) {
    assert.throws(() => validateYoutubePlan({ ...plan, ...change }), /Invalid YouTube plan/);
  }
  validateYoutubePlan(plan);
});

test('legacy adoption is fenced and cannot overwrite a sent create or pending write', async () => {
  const state = fixture();
  await stageYoutubePlan(state.db, lease, plan);
  const payload = { playlistId, title: plan.title, description: plan.description };
  state.expire(true);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'adopt', payload), PlaylistLeaseLostError);
  state.expire(false);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'adopt', { ...payload, title: 'Other edition' }), /Invalid existing/);
  const adopted = await youtubeProviderState(state.db, lease, '', 'adopt', payload);
  assert.equal(adopted.adopted, true);
  assert.equal(adopted.playlistId, playlistId);
  assert.equal(adopted.sent, true);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'reserve', {}), /already sent/);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'adopt', payload), /Invalid existing/);
});

test('only structured explicit rejection releases the matching pending intent under the lease', async () => {
  const state = fixture();
  await stageYoutubePlan(state.db, lease, plan);
  const read = await youtubeProviderState(state.db, lease, '', 'read');
  const metadata = { title: plan.title, description: `${plan.description}\n[${read.marker}]` };
  await youtubeProviderState(state.db, lease, '', 'reserve', metadata);
  const rejection = { status: 403, reason: 'quotaExceeded' };
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'create-rejected', { intent: metadata, rejection: { status: 503, reason: 'backendError' } }), /Invalid YouTube rejection/);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'create-rejected', { intent: { ...metadata, title: 'Different' }, rejection }), /intent mismatch/);
  const reopened = await youtubeProviderState(state.db, lease, '', 'create-rejected', { intent: metadata, rejection });
  assert.equal(reopened.sent, false);
  assert.equal(reopened.creationMetadata, null);
  assert.deepEqual(reopened.lastRejectedWrite, { operation: 'create', ...rejection });
  await youtubeProviderState(state.db, lease, '', 'reserve', metadata);
  await youtubeProviderState(state.db, lease, '', 'bind', playlistId);
  const insert = { playlistId, expectedIds: plan.videoIds.slice(0, 1) };
  await youtubeProviderState(state.db, lease, '', 'insert', insert);
  state.expire(true);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'insert-rejected', { intent: insert, rejection }), PlaylistLeaseLostError);
  state.expire(false);
  assert.deepEqual((await youtubeProviderState(state.db, lease, '', 'read')).pendingInsert, insert);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'insert-rejected', { intent: { ...insert, expectedIds: plan.videoIds }, rejection }), /intent mismatch/);
  const cleared = await youtubeProviderState(state.db, lease, '', 'insert-rejected', { intent: { expectedIds: insert.expectedIds, playlistId }, rejection });
  assert.equal(cleared.pendingInsert, null);
  assert.equal(cleared.playlistId, playlistId);
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'create-rejected', { intent: metadata, rejection }), /creation cannot be reopened/);
});

test('durable YouTube discovery is immutable, edition-bound and rolls back on lease expiry', async () => {
  const state = fixture();
  state.expire(true);
  await assert.rejects(stageYoutubePlan(state.db, lease, plan), PlaylistLeaseLostError);
  assert.equal(state.plans().size, 0);
  state.expire(false);
  assert.deepEqual(await stageYoutubePlan(state.db, lease, plan), plan);
  assert.deepEqual(await stageYoutubePlan(state.db, lease, { ...plan, videoIds: ['00000000003'] }), plan);
  state.binding(url);
  await assert.rejects(stageYoutubePlan(state.db, lease, plan), /binding changed/);
});

test('creation metadata and insert ambiguities survive newer jobs; no reservation may overwrite them', async () => {
  const state = fixture();
  await stageYoutubePlan(state.db, lease, plan);
  const read = await youtubeProviderState(state.db, lease, '', 'read');
  const metadata = { title: plan.title, description: `${plan.description}\n[${read.marker}]` };
  const intent = await youtubeProviderState(state.db, lease, '', 'reserve', metadata);
  await youtubeProviderState(state.db, lease, '', 'bind', playlistId);
  const insert = { playlistId, expectedIds: plan.videoIds.slice(0, 1) };
  await youtubeProviderState(state.db, lease, '', 'insert', insert);
  const next = { ...lease, id: 'newer-job', publicationId: 'newer-publication' };
  await stageYoutubePlan(state.db, next, { ...plan, title: 'Newer festival', videoIds: ['00000000003'] });
  const inherited = await youtubeProviderState(state.db, next, '', 'read');
  assert.equal(inherited.marker, intent.marker);
  assert.deepEqual(inherited.creationMetadata, metadata);
  assert.deepEqual(inherited.pendingInsert, insert);
  await assert.rejects(youtubeProviderState(state.db, next, '', 'reserve', metadata), /already sent/);
  await assert.rejects(youtubeProviderState(state.db, next, '', 'insert', { playlistId, expectedIds: ['00000000003'] }), /unresolved/);
  await youtubeProviderState(state.db, next, '', 'confirm', { expectedIds: insert.expectedIds, playlistId });
  assert.equal((await youtubeProviderState(state.db, next, '', 'read')).pendingInsert, null);
  await youtubeProviderState(state.db, next, '', 'insert', { playlistId, expectedIds: ['00000000003'] });
});

test('existing binding is authoritative; metadata confirmations ignore JSON key order', async () => {
  const state = fixture();
  state.binding(url);
  await stageYoutubePlan(state.db, lease, { ...plan, expectedUrl: url });
  await assert.rejects(youtubeProviderState(state.db, lease, url, 'reserve', {}), /already sent or bound/);
  const metadata = { playlistId, title: plan.title, description: plan.description };
  await youtubeProviderState(state.db, lease, url, 'metadata', metadata);
  await assert.rejects(youtubeProviderState(state.db, lease, url, 'insert', { playlistId, expectedIds: plan.videoIds }), /unresolved/);
  await youtubeProviderState(state.db, lease, url, 'metadata-confirm', { description: metadata.description, title: metadata.title, playlistId });
  state.binding(`https://music.youtube.com/playlist?list=PLanother0001`);
  await assert.rejects(youtubeProviderState(state.db, lease, url, 'read'), /binding changed/);
});

test('partial progress is durable; invalid completion and newer publications fail closed', async () => {
  const state = fixture();
  await stageYoutubePlan(state.db, lease, plan);
  const partial = { verifiedTracks: 1, totalTracks: 2, quotaUsed: 5000, complete: false };
  await saveYoutubeProgress(state.db, lease, '', partial);
  assert.deepEqual(state.progress().get(lease.id), partial);
  await assert.rejects(saveYoutubeProgress(state.db, lease, '', { ...partial, complete: true }), /Invalid YouTube progress/);
  await assert.rejects(saveYoutubeProgress(state.db, lease, '', { ...partial, quotaUsed: 5001 }), /Invalid YouTube progress/);
  state.newer();
  await assert.rejects(youtubeProviderState(state.db, lease, '', 'read'), /Newer playlist publication/);
});
