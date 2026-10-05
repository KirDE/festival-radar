import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { assertPlaylistRefreshLease, commitPlaylistRefresh, finishPlaylistRefresh, PlaylistLeaseLostError } from "../lib/catalog/playlist-queue.ts";

const lease = { id: "job", publicationId: "publication", festivalSlug: "festival", attempts: 1, leaseOwner: randomUUID(), leaseExpiresAt: new Date() };
const unavailable = { $transaction() { throw new Error("database accessed"); } } as unknown as PrismaClient;

test("fencing APIs reject malformed lease identity before DB access", async () => {
  for (const change of [{ id: "" }, { publicationId: "" }, { festivalSlug: "" }, { attempts: 0 }, { attempts: 1.5 }, { leaseOwner: "bad" }, { leaseExpiresAt: new Date("invalid") }]) {
    const invalid = { ...lease, ...change };
    await assert.rejects(assertPlaylistRefreshLease(unavailable, invalid), /Invalid playlist lease/);
    await assert.rejects(commitPlaylistRefresh(unavailable, invalid, async () => { assert.fail("write called"); }), /Invalid playlist lease/);
    await assert.rejects(finishPlaylistRefresh(unavailable, invalid, new Date(), "SUCCEEDED"), /Invalid playlist lease/);
  }
});

test("completion reports lease loss but propagates database failures", async () => {
  const lost = { $transaction() { throw new PlaylistLeaseLostError(); } } as unknown as PrismaClient;
  assert.equal(await finishPlaylistRefresh(lost, lease, new Date(), "FAILED"), false);
  await assert.rejects(finishPlaylistRefresh(unavailable, lease, new Date(), "FAILED"), /database accessed/);
  await assert.rejects(commitPlaylistRefresh(lost, lease, async () => { assert.fail("write called"); }), PlaylistLeaseLostError);
});
