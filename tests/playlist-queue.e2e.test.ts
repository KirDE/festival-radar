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
// Publications are append-only; this suite runs only against a disposable database.
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
  const racePublication = await first.catalogPublication.create({ data: {
    source: "INGESTION", sourceId: `playlist-race:${randomUUID()}`, festivalSlug: "queue-race",
    editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
  } });
  try {
    const [one, two] = await Promise.all([
      enqueuePlaylistRefresh(first, racePublication.id), enqueuePlaylistRefresh(second, racePublication.id),
    ]);
    assert.equal(one.id, two.id);
    assert.equal(await first.catalogPlaylistRefresh.count({ where: { publicationId: racePublication.id } }), 1);
  } finally {
    // Leave no claimable work for the next test; publications remain append-only.
    await first.catalogPlaylistRefresh.updateMany({
      where: { publicationId: racePublication.id }, data: { status: "SUCCEEDED" },
    });
  }
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
  const failedRow = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(failedRow.retryAt?.getTime(), base.getTime() + 180_002);
  assert.equal(await claimPlaylistRefresh(first, input(ownerA, new Date(base.getTime() + 180_001))), null);
  const retried = await claimPlaylistRefresh(first, input(ownerA, new Date(base.getTime() + 180_002)));
  assert.equal(retried?.id, jobId);
  assert.equal(await finishPlaylistRefresh(first, retried, new Date(base.getTime() + 180_003), "SUCCEEDED"), true);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: jobId } })).status, "SUCCEEDED");
  assert.equal(await claimPlaylistRefresh(second, input(ownerB, new Date(base.getTime() + 180_004))), null);
});

test("malformed claims fail before any DB access", async () => {
  const unavailable = { $queryRaw: () => { throw new Error("database accessed"); } } as unknown as PrismaClient;
  await assert.rejects(claimPlaylistRefresh(unavailable, input("invalid")), /Invalid playlist lease owner/);
  await assert.rejects(claimPlaylistRefresh(unavailable, { ...input(ownerA), ttlMs: 1 }), /Invalid playlist lease duration/);
});
