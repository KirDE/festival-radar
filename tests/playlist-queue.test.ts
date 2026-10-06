import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { assertPlaylistRefreshLease, commitPlaylistRefresh, finishPlaylistRefresh, PlaylistLeaseLostError, renewPlaylistRefreshLease, claimPlaylistRefresh } from "../lib/catalog/playlist-queue.ts";

const lease = { id: "job", publicationId: "publication", festivalSlug: "festival", attempts: 1, leaseOwner: randomUUID(), leaseExpiresAt: new Date() };
const unavailable = { $transaction() { throw new Error("database accessed"); } } as unknown as PrismaClient;

test("fencing APIs reject malformed lease identity before DB access", async () => {
  for (const change of [{ id: "" }, { publicationId: "" }, { festivalSlug: "" }, { attempts: 0 }, { attempts: 1.5 }, { leaseOwner: "bad" }, { leaseExpiresAt: new Date("invalid") }]) {
    const invalid = { ...lease, ...change };
    await assert.rejects(assertPlaylistRefreshLease(unavailable, invalid), /Invalid playlist lease/);
    await assert.rejects(commitPlaylistRefresh(unavailable, invalid, async () => { assert.fail("write called"); }), /Invalid playlist lease/);
    await assert.rejects(renewPlaylistRefreshLease(unavailable, invalid, 60_000), /Invalid playlist lease/);
    await assert.rejects(finishPlaylistRefresh(unavailable, invalid, "SUCCEEDED"), /Invalid playlist lease/);
  }
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
