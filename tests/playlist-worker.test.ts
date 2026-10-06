import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { runPlaylistWorker } from '../lib/catalog/playlist-worker.ts';
import { PlaylistLeaseLostError } from '../lib/catalog/playlist-queue.ts';

const url = 'https://open.spotify.com/playlist/' + 'a'.repeat(22);

function fixture(initialUrl: string | null, verifiedId: string | null = null, youtube?: { url: string | null; complete: boolean; pending?: boolean; verifiedId?: string }) {
  let current = initialUrl === null ? null : { id: 'binding', url: initialUrl };
  let claim: Record<string, unknown>;
  const writes: unknown[] = [];
  let lost = false;
  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join('?');
      if (sql.includes('SELECT candidate.id')) return [{ id: 'job', festivalSlug: 'festival', requestedAt: new Date() }];
      if (sql.includes('pg_try_advisory')) return [{ acquired: true }];
      if (sql.includes('RETURNING job.id')) {
        claim = { id: 'job', publicationId: 'publication', festivalSlug: 'festival', attempts: 1, leaseOwner: values[0], leaseExpiresAt: new Date(Date.now() + 120_000) };
        return [claim];
      }
      if (sql.includes("->>'playlistId'")) return [{ playlistId: verifiedId }];
      if (sql.includes('SELECT "youtubePlan",')) return [{
        youtubePlan: { slug: 'festival', editionYear: 2027, expectedUrl: youtube?.url ?? '', title: 'Festival', description: 'Description', videoIds: ['00000000001', '00000000002', '00000000003'], artists: 1, sourceTracks: 3 },
        youtubeState: { sent: true, playlistId: youtube?.verifiedId ?? 'PLsynthetic001', pendingInsert: youtube?.pending ? { playlistId: 'PLsynthetic001', expectedIds: ['00000000001'] } : null },
        youtubeProgress: { complete: youtube?.complete, verifiedTracks: 3 },
      }];
      if (sql.includes('job.status')) return lost ? [] : [{ id: 'job' }];
      return [{ id: 'job' }];
    },
    async $executeRaw() { return 1; },
    festivalEdition: { async findFirstOrThrow() { return { id: 'edition' }; } },
    catalogPublication: { async findUniqueOrThrow() { return { editionYear: 2027, createdAt: new Date() }; } },
    catalogPlaylistRefresh: { async count() { return 0; } },
    festivalPlaylist: {
      async findUnique({ where }: { where: { editionId_provider: { provider: string } } }) {
        if (where.editionId_provider.provider === 'youtube_music') return youtube?.url ? { id: 'youtube-binding', url: youtube.url } : null;
        return current;
      },
      async create({ data }: { data: unknown }) { writes.push(data); },
      async updateMany({ where, data }: { where: { id: string; url: string }; data: unknown }) {
        if (where.url !== (where.id === 'youtube-binding' ? youtube?.url : current?.url)) return { count: 0 };
        writes.push(data);
        return { count: 1 };
      },
    },
  };
  const db = { async $transaction(callback: (value: typeof tx) => Promise<unknown>) { return callback(tx); } } as unknown as PrismaClient;
  return { db, writes, lose() { lost = true; }, rebind() { current = { id: 'binding', url: 'https://open.spotify.com/playlist/' + 'c'.repeat(22) }; } };
}

test('worker creates DB binding only for durably verified provider ID', async () => {
  const valid = fixture(null, 'a'.repeat(22));
  assert.equal((await runPlaylistWorker(valid.db, async () => ({ url, expectedUrl: '', artists: 2, tracks: 3 }))).status, 'SUCCEEDED');
  assert.equal(valid.writes.length, 1);
  assert.equal((valid.writes[0] as { url: string }).url, url);
  const unknown = fixture(null);
  await assert.rejects(runPlaylistWorker(unknown.db, async () => ({ url, expectedUrl: '', artists: 2, tracks: 3 })), /Unverified playlist creation/);
  assert.equal(unknown.writes.length, 0);
});

const youtubeUrl = 'https://music.youtube.com/playlist?list=PLsynthetic001';
test('worker commits both providers only after complete durable YouTube readback', async () => {
  for (const expected of [null, 'NEW', youtubeUrl]) {
    const state = fixture(url, null, { url: expected, complete: true });
    const result = await runPlaylistWorker(state.db, async () => ({ url, artists: 2, tracks: 3, youtubeMusic: { url: youtubeUrl, expectedUrl: expected ?? '', artists: 1, tracks: 3 } }));
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(state.writes.length, 2);
  }
});

test('partial, ambiguous and unverified YouTube results cannot publish either provider', async () => {
  for (const config of [{ url: null, complete: false }, { url: null, complete: true, pending: true }, { url: null, complete: true, verifiedId: 'PLwrong000001' }]) {
    const state = fixture(url, null, config);
    await assert.rejects(runPlaylistWorker(state.db, async () => ({ url, artists: 2, tracks: 3, youtubeMusic: { url: youtubeUrl, expectedUrl: '', artists: 1, tracks: 3 } })), /Incomplete YouTube publication|Unverified YouTube creation/);
    assert.equal(state.writes.length, 0);
  }
});

test('worker replaces NEW binding and preserves existing playlist update behavior', async () => {
  for (const initial of ['NEW', url]) {
    const state = fixture(initial, 'a'.repeat(22));
    await runPlaylistWorker(state.db, async () => ({ url, expectedUrl: initial, artists: 2, tracks: 3 }));
    assert.equal(state.writes.length, 1);
  }
});

test('binding change and lease loss prevent DB publication', async () => {
  const changed = fixture(url);
  await assert.rejects(runPlaylistWorker(changed.db, async () => {
    changed.rebind();
    return { url, artists: 2, tracks: 3 };
  }), /binding changed/);
  assert.equal(changed.writes.length, 0);
  const lost = fixture(null, 'a'.repeat(22));
  await assert.rejects(runPlaylistWorker(lost.db, async () => {
    lost.lose();
    return { url, expectedUrl: '', artists: 2, tracks: 3 };
  }), PlaylistLeaseLostError);
  assert.equal(lost.writes.length, 0);
});
