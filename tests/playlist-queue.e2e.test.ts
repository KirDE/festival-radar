import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { claimPlaylistRefresh, enqueuePlaylistRefresh, finishPlaylistRefresh } from "../lib/catalog/playlist-queue.ts";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("A disposable test/integration DATABASE_URL is required");
const first = new PrismaClient();
const second = new PrismaClient();
const ownerA = randomUUID();
const ownerB = randomUUID();
const base = new Date("2027-03-01T00:00:00.000Z");
const input = (owner: string, now = base) => ({ owner, now, ttlMs: 60_000 });
let publicationId: string;
let jobId: string;

test.before(async () => {
  const publication = await first.catalogPublication.create({ data: {
    source: "INGESTION", sourceId: `playlist-queue-test:${randomUUID()}`,
    festivalSlug: `queue-test-${randomUUID()}`, editionYear: 2027,
    actorLabel: "test", fields: ["lineup"], lineupChanged: true,
  } });
  publicationId = publication.id;
  const job = await enqueuePlaylistRefresh(first, publicationId);
  jobId = job.id;
  await first.catalogPlaylistRefresh.update({ where: { id: jobId }, data: { requestedAt: base } });
});
test.after(async () => { await Promise.all([first.$disconnect(), second.$disconnect()]); });

test("publication enqueue dedupes across clients and rejects non-lineup publications", async () => {
  const [a, b] = await Promise.all([enqueuePlaylistRefresh(first, publicationId), enqueuePlaylistRefresh(second, publicationId)]);
  assert.equal(a.id, jobId);
  assert.equal(b.id, jobId);
  assert.equal(await first.catalogPlaylistRefresh.count({ where: { publicationId } }), 1);
  const noLineup = await first.catalogPublication.create({ data: {
    source: "ADMIN", sourceId: `playlist-no-lineup:${randomUUID()}`, festivalSlug: "queue-test",
    editionYear: 2027, actorLabel: "test", fields: ["dates"], lineupChanged: false,
  } });
  await assert.rejects(enqueuePlaylistRefresh(first, noLineup.id), /lineup publication/);
});

test("atomic claim, expiry reclaim and attempt-fenced completion", async () => {
  const [a, b] = await Promise.all([claimPlaylistRefresh(first, input(ownerA)), claimPlaylistRefresh(second, input(ownerB))]);
  const claim = a?.id === jobId ? a : b?.id === jobId ? b : null;
  assert.ok(claim);
  assert.equal([a, b].filter((value) => value?.id === jobId).length, 1);
  assert.equal(await finishPlaylistRefresh(first, claim, new Date(base.getTime() + 60_000), "SUCCEEDED"), false);
  const reclaimed = await claimPlaylistRefresh(second, input(ownerB, new Date(base.getTime() + 60_001)));
  assert.equal(reclaimed?.id, jobId);
  assert.equal(reclaimed.attempts, claim.attempts + 1);
  assert.equal(await finishPlaylistRefresh(first, claim, new Date(base.getTime() + 60_002), "FAILED"), false);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, new Date(base.getTime() + 60_002), "FAILED"), true);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, new Date(base.getTime() + 60_003), "SUCCEEDED"), false);
  const retried = await claimPlaylistRefresh(first, input(ownerA, new Date(base.getTime() + 60_003)));
  assert.equal(retried?.id, jobId);
  assert.equal(await finishPlaylistRefresh(first, retried, new Date(base.getTime() + 60_004), "SUCCEEDED"), true);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: jobId } })).status, "SUCCEEDED");
  assert.equal(await claimPlaylistRefresh(second, input(ownerB, new Date(base.getTime() + 60_005))), null);
});

test("malformed claims fail before any DB access", async () => {
  const unavailable = { $queryRaw: () => { throw new Error("database accessed"); } } as unknown as PrismaClient;
  await assert.rejects(claimPlaylistRefresh(unavailable, input("invalid")), /Invalid playlist lease owner/);
  await assert.rejects(claimPlaylistRefresh(unavailable, { ...input(ownerA), ttlMs: 1 }), /Invalid playlist lease duration/);
});
