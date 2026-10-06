import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { assertPlaylistRefreshLease, commitPlaylistRefresh, finishPlaylistRefresh, PlaylistLeaseLostError, renewPlaylistRefreshLease, claimPlaylistRefresh, spotifyCreationState } from "../lib/catalog/playlist-queue.ts";

const lease = { id: "job", publicationId: "publication", festivalSlug: "festival", attempts: 1, leaseOwner: randomUUID(), leaseExpiresAt: new Date() };
const unavailable = { $transaction() { throw new Error("database accessed"); } } as unknown as PrismaClient;

test("fencing APIs reject malformed lease identity before DB access", async () => {
  for (const change of [{ id: "" }, { publicationId: "" }, { festivalSlug: "" }, { attempts: 0 }, { attempts: 1.5 }, { leaseOwner: "bad" }, { leaseExpiresAt: new Date("invalid") }]) {
    const invalid = { ...lease, ...change };
    await assert.rejects(assertPlaylistRefreshLease(unavailable, invalid), /Invalid playlist lease/);
    await assert.rejects(commitPlaylistRefresh(unavailable, invalid, async () => { assert.fail("write called"); }), /Invalid playlist lease/);
    await assert.rejects(renewPlaylistRefreshLease(unavailable, invalid, 60_000), /Invalid playlist lease/);
    await assert.rejects(finishPlaylistRefresh(unavailable, invalid, "SUCCEEDED"), /Invalid playlist lease/);
    await assert.rejects(spotifyCreationState(unavailable, invalid, 'reserve', ''), /Invalid playlist lease/);
  }
});

test('creation state rejects unsafe binding requests and propagates lease loss', async () => {
  await assert.rejects(spotifyCreationState(unavailable, lease, 'bind', '', 'bad'), /Invalid creation state request/);
  await assert.rejects(spotifyCreationState(unavailable, lease, 'reserve', 'https://open.spotify.com/playlist/' + 'a'.repeat(22)), /Invalid creation state request/);
  const lost = { $transaction() { throw new PlaylistLeaseLostError(); } } as unknown as PrismaClient;
  await assert.rejects(spotifyCreationState(lost, lease, 'reserve', 'NEW'), PlaylistLeaseLostError);
});

test('creation reservations are shared across jobs and roll back on expiry', async () => {
  type State = { marker: string; sent: boolean; playlistId: string | null };
  let stored: { id: string; spotifyCreation: State } | null = null;
  let expireAfterWrite = false;
  const mock = { async $transaction(callback: (tx: unknown) => Promise<unknown>) {
    let pending = stored ? structuredClone(stored) : null;
    let expired = false;
    const tx = {
      async $queryRaw(strings: TemplateStringsArray) {
        const sql = strings.join('?');
        if (sql.includes('job."spotifyCreation"')) return pending ? [structuredClone(pending)] : [];
        if (sql.includes("job.status = 'RUNNING'")) return expired ? [] : [{ id: 'job' }];
        return [{ id: 'job' }];
      },
      async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        if (strings.join('?').includes('SET "spotifyCreation"')) {
          pending = { id: values[1] as string, spotifyCreation: JSON.parse(values[0] as string) };
          expired = expireAfterWrite;
        }
        return 1;
      },
      catalogPublication: { async findUniqueOrThrow() { return { editionYear: 2027, createdAt: new Date() }; } },
      festivalEdition: { async findFirstOrThrow() { return { id: 'edition' }; } },
      festivalPlaylist: { async findUnique() { return null; } },
      catalogPlaylistRefresh: { async count() { return 0; } },
    };
    const result = await callback(tx);
    stored = pending;
    return result;
  } } as unknown as PrismaClient;
  expireAfterWrite = true;
  await assert.rejects(spotifyCreationState(mock, lease, 'reserve', ''), PlaylistLeaseLostError);
  assert.equal(stored, null);
  expireAfterWrite = false;
  const intent = await spotifyCreationState(mock, lease, 'reserve', '');
  const newer = { ...lease, id: 'newer-job', publicationId: 'newer-publication' };
  assert.deepEqual(await spotifyCreationState(mock, newer, 'read', ''), intent);
  await assert.rejects(spotifyCreationState(mock, newer, 'reserve', ''), /already sent/);
  const bound = await spotifyCreationState(mock, newer, 'bind', '', 'a'.repeat(22));
  assert.equal(bound.marker, intent.marker);
  assert.equal(bound.playlistId, 'a'.repeat(22));
  await assert.rejects(spotifyCreationState(mock, newer, 'bind', '', 'b'.repeat(22)), /identity mismatch/);
});

test("completion reports lease loss but propagates database failures", async () => {
  const lost = { $transaction() { throw new PlaylistLeaseLostError(); } } as unknown as PrismaClient;
  assert.equal(await finishPlaylistRefresh(lost, lease, "FAILED"), false);
  await assert.rejects(finishPlaylistRefresh(unavailable, lease, "FAILED"), /database accessed/);
  await assert.rejects(commitPlaylistRefresh(lost, lease, async () => { assert.fail("write called"); }), PlaylistLeaseLostError);
});

test("claim and renewal bound TTL before database access", async () => {
  for (const ttlMs of [999, 3_600_001, 1_000.5, NaN, Infinity]) {
    await assert.rejects(claimPlaylistRefresh(unavailable, { owner: lease.leaseOwner, ttlMs }), /Invalid playlist lease duration/);
    await assert.rejects(renewPlaylistRefreshLease(unavailable, lease, ttlMs), /Invalid playlist lease duration/);
  }
  for (const ttlMs of [1_000, 3_600_000]) {
    await assert.rejects(claimPlaylistRefresh(unavailable, { owner: lease.leaseOwner, ttlMs }), /database accessed/);
    await assert.rejects(renewPlaylistRefreshLease(unavailable, lease, ttlMs), /database accessed/);
  }
  await assert.rejects(claimPlaylistRefresh(unavailable, { owner: "bad", ttlMs: 60_000 }), /Invalid playlist lease owner/);
  await assert.rejects(claimPlaylistRefresh(unavailable, {
    owner: lease.leaseOwner, ttlMs: 60_000, cursor: { id: "bad", requestedAt: new Date() },
  }), /Invalid playlist claim cursor/);
});

test("renewal propagates lease loss and database failures", async () => {
  const lost = { $transaction() { throw new PlaylistLeaseLostError(); } } as unknown as PrismaClient;
  await assert.rejects(renewPlaylistRefreshLease(lost, lease, 60_000), PlaylistLeaseLostError);
  await assert.rejects(renewPlaylistRefreshLease(unavailable, lease, 60_000), /database accessed/);
  await assert.rejects(finishPlaylistRefresh(unavailable, lease, "PENDING" as "FAILED"), /Invalid playlist completion outcome/);
});
