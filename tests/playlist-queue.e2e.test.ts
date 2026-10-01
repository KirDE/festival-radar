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

// Two publications of the same festival must not overlap, even when a third
// publication for an unrelated festival is ready. Use independent connections.
test("simultaneous festival claims serialize siblings but permit other festivals", async () => {
  const slug = `queue-shared-${randomUUID()}`;
  const otherSlug = `queue-other-${randomUUID()}`;
  async function queue(festivalSlug: string, minute: number) {
    const publication = await first.catalogPublication.create({ data: {
      source: "INGESTION", sourceId: `playlist-shared:${randomUUID()}`,
      festivalSlug, editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
    } });
    const job = await enqueuePlaylistRefresh(first, publication.id);
    await first.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { requestedAt: new Date(base.getTime() + minute) } });
    return job.id;
  }
  const siblingIds = [await queue(slug, 1), await queue(slug, 2)];
  const otherId = await queue(otherSlug, 3);
  const [a, b] = await Promise.all([claimPlaylistRefresh(first, input(ownerA)), claimPlaylistRefresh(second, input(ownerB))]);
  assert.equal([a, b].filter((claim) => claim && siblingIds.includes(claim.id)).length, 1);
  const active = [a, b].find((claim) => claim && siblingIds.includes(claim.id))!;
  assert.equal(await first.catalogPlaylistRefresh.count({ where: { festivalSlug: slug, status: "RUNNING" } }), 1);
  const other = [a, b].find((claim) => claim?.id === otherId) ?? await claimPlaylistRefresh(second, input(ownerB));
  assert.equal(other?.id, otherId);
  assert.equal(await claimPlaylistRefresh(first, input(ownerA)), null);
  assert.equal(await finishPlaylistRefresh(first, active, new Date(base.getTime() + 1_000), "SUCCEEDED"), true);
  const next = await claimPlaylistRefresh(second, input(ownerB, new Date(base.getTime() + 1_001)));
  assert.equal(next?.id, siblingIds.find((id) => id !== active.id));
  assert.equal(await finishPlaylistRefresh(second, next!, new Date(base.getTime() + 1_002), "SUCCEEDED"), true);
  assert.equal(await finishPlaylistRefresh(first, other!, new Date(base.getTime() + 1_003), "SUCCEEDED"), true);
});

test("expired sibling cannot be claimed beside a RUNNING festival row; legacy rows block", async () => {
  const slug = `queue-expiry-${randomUUID()}`;
  async function queue() {
    const pub = await first.catalogPublication.create({ data: {
      source: "INGESTION", sourceId: `playlist-expiry:${randomUUID()}`,
      festivalSlug: slug, editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
    } });
    const job = await enqueuePlaylistRefresh(first, pub.id);
    await first.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { requestedAt: base } });
    return job.id;
  }
  const firstId = await queue();
  const secondId = await queue();
  const legacy = await first.catalogPlaylistRefresh.update({ where: { id: firstId }, data: {
    status: "RUNNING", leaseOwner: null, leaseExpiresAt: null, startedAt: base,
  } });
  assert.equal(await claimPlaylistRefresh(second, input(ownerB)), null);
  // A cutover is needed: never auto-reclaim an unleased legacy RUNNING row.
  await first.catalogPlaylistRefresh.update({ where: { id: legacy.id }, data: { status: "FAILED", retryAt: null } });
  const claimed = await claimPlaylistRefresh(first, input(ownerA));
  assert.equal(claimed?.id, secondId);
  assert.equal(await claimPlaylistRefresh(second, input(ownerB, new Date(base.getTime() + 59_999))), null);
  const reclaimed = await claimPlaylistRefresh(second, input(ownerB, new Date(base.getTime() + 60_001)));
  assert.equal(reclaimed?.id, secondId);
  assert.equal(reclaimed.attempts, claimed.attempts + 1);
  assert.equal(await finishPlaylistRefresh(first, claimed, new Date(base.getTime() + 60_002), "SUCCEEDED"), false);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, new Date(base.getTime() + 60_002), "SUCCEEDED"), true);
  assert.equal(await claimPlaylistRefresh(first, input(ownerA, new Date(base.getTime() + 60_003))), null);
});

test("a held festival transaction lock does not block another festival", async () => {
  const lockedSlug = `queue-locked-${randomUUID()}`;
  async function queue(slug: string, ms: number) {
    const pub = await first.catalogPublication.create({ data: {
      source: "INGESTION", sourceId: `playlist-lock:${randomUUID()}`,
      festivalSlug: slug, editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
    } });
    const job = await enqueuePlaylistRefresh(first, pub.id);
    await first.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { requestedAt: new Date(base.getTime() + ms) } });
    return job.id;
  }
  const lockedId = await queue(lockedSlug, 1);
  const availableId = await queue(`queue-available-${randomUUID()}`, 2);
  let release!: () => void;
  let held!: () => void;
  const untilReleased = new Promise<void>((resolve) => { release = resolve; });
  const lockHeld = new Promise<void>((resolve) => { held = resolve; });
  const holding = first.$transaction(async (tx) => {
    const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(210, hashtext(${lockedSlug})) AS acquired`;
    assert.equal(acquired, true);
    held();
    await untilReleased;
  });
  try {
    await lockHeld;
    const claim = await claimPlaylistRefresh(second, input(ownerB));
    assert.equal(claim?.id, availableId);
    assert.equal(await finishPlaylistRefresh(second, claim!, new Date(base.getTime() + 1_000), "SUCCEEDED"), true);
  } finally {
    release();
    await holding;
  }
  const next = await claimPlaylistRefresh(second, input(ownerB));
  assert.equal(next?.id, lockedId);
  assert.equal(await finishPlaylistRefresh(second, next!, new Date(base.getTime() + 1_001), "SUCCEEDED"), true);
});
