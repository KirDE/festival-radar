import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { claimPlaylistRefresh as claimPage, enqueuePlaylistRefresh, finishPlaylistRefresh, assertPlaylistRefreshLease, commitPlaylistRefresh, PlaylistLeaseLostError, renewPlaylistRefreshLease } from "../lib/catalog/playlist-queue.ts";
import type { PlaylistClaimCursor } from "../lib/catalog/playlist-queue.ts";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("A disposable test/integration DATABASE_URL is required");
const first = new PrismaClient();
const second = new PrismaClient();
const ownerA = randomUUID();
const ownerB = randomUUID();
// Only a stable queue-order key, never a lease clock.
const base = new Date("2027-03-01T00:00:00.000Z");
async function expireLease(id: string) {
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${id}`;
}
const input = (owner: string) => ({ owner, ttlMs: 60_000 });
// Convenience for older scenarios; production callers own this continuation
// across calls, never inside a single interactive transaction.
async function claimPlaylistRefresh(
  db: PrismaClient, options: ReturnType<typeof input>, hook?: (slug: string) => Promise<void>,
) {
  let cursor: PlaylistClaimCursor | null = null;
  for (let page = 0; page < 16; page++) {
    const result = await claimPage(db, { ...options, cursor }, hook);
    if (result.claim || !result.nextCursor) return result.claim;
    cursor = result.nextCursor;
  }
  throw new Error("Test exceeded claim scan page budget");
}
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
  await expireLease(claim.id);
  assert.equal(await finishPlaylistRefresh(first, claim, "SUCCEEDED"), false);
  const reclaimed = await claimPlaylistRefresh(second, input(ownerB));
  assert.equal(reclaimed?.id, jobId);
  assert.equal(reclaimed.attempts, claim.attempts + 1);
  assert.equal(await finishPlaylistRefresh(first, claim, "FAILED"), false);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "FAILED"), true);
  const failedSnapshot = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: jobId } });
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "FAILED"), false);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "SUCCEEDED"), false);
  const failedRow = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: jobId } });
  assert.deepEqual(failedRow, failedSnapshot);
  assert.equal(failedRow.retryAt!.getTime() - failedRow.completedAt!.getTime(), 120_000);
  assert.equal(failedRow.completedAt!.getTime(), failedRow.updatedAt.getTime());
  const [{ now }] = await first.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  assert.ok(failedRow.completedAt! <= now);
  assert.ok(now.getTime() - failedRow.completedAt!.getTime() < 5_000);
  assert.equal(await claimPlaylistRefresh(first, input(ownerA)), null);
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "retryAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${jobId}`;
  const retried = await claimPlaylistRefresh(first, input(ownerA));
  assert.equal(retried?.id, jobId);
  assert.equal(await finishPlaylistRefresh(first, retried, "SUCCEEDED"), true);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: jobId } })).status, "SUCCEEDED");
  assert.equal(await claimPlaylistRefresh(second, input(ownerB)), null);
});

test("malformed claims fail before any DB access", async () => {
  const unavailable = { $queryRaw: () => { throw new Error("database accessed"); } } as unknown as PrismaClient;
  await assert.rejects(claimPlaylistRefresh(unavailable, input("invalid")), /Invalid playlist lease owner/);
  await assert.rejects(claimPlaylistRefresh(unavailable, { ...input(ownerA), ttlMs: 1 }), /Invalid playlist lease duration/);
  await assert.rejects(claimPage(unavailable, { ...input(ownerA), cursor: { requestedAt: new Date("invalid"), id: randomUUID() } }), /Invalid playlist claim cursor/);
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
  assert.equal(await finishPlaylistRefresh(first, active, "SUCCEEDED"), true);
  const next = await claimPlaylistRefresh(second, input(ownerB));
  assert.equal(next?.id, siblingIds.find((id) => id !== active.id));
  assert.equal(await finishPlaylistRefresh(second, next!, "SUCCEEDED"), true);
  assert.equal(await finishPlaylistRefresh(first, other!, "SUCCEEDED"), true);
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
  assert.equal(await claimPlaylistRefresh(second, input(ownerB)), null);
  await expireLease(claimed.id);
  const reclaimed = await claimPlaylistRefresh(second, input(ownerB));
  assert.equal(reclaimed?.id, secondId);
  assert.equal(reclaimed.attempts, claimed.attempts + 1);
  assert.equal(await finishPlaylistRefresh(first, claimed, "SUCCEEDED"), false);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "SUCCEEDED"), true);
  assert.equal(await claimPlaylistRefresh(first, input(ownerA)), null);
});

test("claiming A while its transaction is paused does not lock B", async () => {
  const slugA = `queue-locked-${randomUUID()}`;
  const slugB = `queue-available-${randomUUID()}`;
  async function queue(slug: string, ms: number) {
    const pub = await first.catalogPublication.create({ data: {
      source: "INGESTION", sourceId: `playlist-lock:${randomUUID()}`,
      festivalSlug: slug, editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
    } });
    const job = await enqueuePlaylistRefresh(first, pub.id);
    await first.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { requestedAt: new Date(base.getTime() + ms) } });
    return job.id;
  }
  const lockedId = await queue(slugA, 1);
  // More jobs in A than a candidate page: B must still be reachable.
  for (let i = 2; i <= 35; i++) await queue(slugA, i);
  const availableId = await queue(slugB, 36);
  let release!: () => void;
  let held!: () => void;
  const untilReleased = new Promise<void>((resolve) => { release = resolve; });
  const lockHeld = new Promise<void>((resolve) => { held = resolve; });
  const holding = claimPlaylistRefresh(first, input(ownerA), async (festivalSlug) => {
    assert.equal(festivalSlug, slugA);
    held();
    await untilReleased;
  });
  let next: Awaited<ReturnType<typeof claimPlaylistRefresh>>;
  try {
    await lockHeld;
    // A has not updated its job yet. This tests the precise lock window,
    // rather than depending on whether an ordinary claim commits quickly.
    assert.equal((await second.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: lockedId } })).status, "PENDING");
    const claim = await claimPlaylistRefresh(second, input(ownerB));
    assert.equal(claim?.id, availableId);
    assert.equal(await finishPlaylistRefresh(second, claim!, "SUCCEEDED"), true);
  } finally {
    release();
    next = await holding;
  }
  assert.equal(next?.id, lockedId);
  // While the first A lease runs, its other 34 jobs must not be claimable.
  assert.equal(await claimPlaylistRefresh(second, input(ownerB)), null);
  assert.equal(await finishPlaylistRefresh(first, next!, "SUCCEEDED"), true);
  // This disposable suite shares one database; leave no A siblings claimable.
  await first.catalogPlaylistRefresh.updateMany({
    where: { festivalSlug: slugA, status: "PENDING" }, data: { status: "SUCCEEDED" },
  });
});

test("a newly RUNNING sibling after advisory lock blocks a stale candidate", async () => {
  const slug = "queue-snapshot-" + randomUUID();
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const pub = await first.catalogPublication.create({ data: {
      source: "INGESTION", sourceId: "playlist-snapshot:" + randomUUID(),
      festivalSlug: slug, editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
    } });
    const job = await enqueuePlaylistRefresh(first, pub.id);
    ids.push(job.id);
    await first.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { requestedAt: new Date(base.getTime() + i) } });
  }
  const page = await claimPage(first, input(ownerA), async (lockedSlug) => {
    assert.equal(lockedSlug, slug);
    // Separate connection commits between advisory lock and fresh-snapshot
    // SELECT FOR UPDATE. An earlier candidate snapshot still saw both PENDING.
    await second.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET status = 'RUNNING',
      "startedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "leaseOwner" = ${ownerB},
      "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 minute' WHERE id = ${ids[1]}`;
  });
  assert.equal(page.claim, null);
  assert.equal(page.nextCursor, null);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: ids[0] } })).status, "PENDING");
  assert.equal(await first.catalogPlaylistRefresh.count({ where: { festivalSlug: slug, status: "RUNNING" } }), 1);
  await second.catalogPlaylistRefresh.updateMany({ where: { id: { in: ids } }, data: { status: "SUCCEEDED" } });
});

test("multiple bounded calls resume past >32 contended festivals", async () => {
  const blocked = Array.from({ length: 65 }, () => `queue-busy-${randomUUID()}`);
  const availableSlug = `queue-page-${randomUUID()}`;
  let ms = 1;
  let availableId = "";
  const blockedIds: string[] = [];
  for (const slug of [...blocked, availableSlug]) {
    const pub = await first.catalogPublication.create({ data: {
      source: "INGESTION", sourceId: `playlist-page:${randomUUID()}`,
      festivalSlug: slug, editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
    } });
    const job = await enqueuePlaylistRefresh(first, pub.id);
    await first.catalogPlaylistRefresh.update({ where: { id: job.id }, data: { requestedAt: new Date(base.getTime() + ms++) } });
    if (slug === availableSlug) availableId = job.id;
    else blockedIds.push(job.id);
  }
  let release!: () => void;
  let held!: () => void;
  const untilReleased = new Promise<void>((resolve) => { release = resolve; });
  const lockHeld = new Promise<void>((resolve) => { held = resolve; });
  const holding = first.$transaction(async (tx) => {
    for (const slug of blocked) {
      const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(210, hashtext(${slug})) AS acquired`;
      assert.equal(acquired, true);
    }
    held();
    await untilReleased;
  });
  try {
    await lockHeld;
    let cursor: PlaylistClaimCursor | null = null;
    for (const lastIndex of [15, 31, 47, 63]) {
      const page = await claimPage(second, { ...input(ownerB), cursor });
      assert.equal(page.claim, null);
      assert.equal(page.nextCursor?.id, blockedIds[lastIndex]);
      cursor = page.nextCursor;
    }
    const page = await claimPage(second, { ...input(ownerB), cursor });
    assert.equal(page.claim?.id, availableId);
    assert.equal(page.nextCursor, null);
    assert.equal(await finishPlaylistRefresh(second, page.claim!, "SUCCEEDED"), true);
  } finally {
    release();
    await holding;
    await first.catalogPlaylistRefresh.updateMany({ where: { festivalSlug: { in: blocked } }, data: { status: "SUCCEEDED" } });
  }
});

// All lease scenarios use database time. No Spotify or live consumer is involved.
async function fencedFixture(ttlMs = 60_000) {
  const slug = `queue-fence-${randomUUID()}`;
  const festival = await first.festival.create({ data: {
    slug, name: "Fence test", country: "Germany", countryCode: "DE", officialUrl: "https://example.test", genres: [],
    editions: { create: { year: 2027, status: "CONFIRMED", ticketStatus: "UNKNOWN", recordState: "CURRENT", completeness: "COMPLETE", sourceUpdatedAt: new Date() } },
  }, include: { editions: true } });
  const publication = await first.catalogPublication.create({ data: {
    source: "INGESTION", sourceId: `playlist-fence:${randomUUID()}`, festivalSlug: slug,
    editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
  } });
  const job = await enqueuePlaylistRefresh(first, publication.id);
  const page = await claimPage(first, { owner: ownerA, ttlMs });
  assert.equal(page.claim?.id, job.id);
  return { claim: page.claim!, editionId: festival.editions[0].id, slug };
}

const playlistWrite = (editionId: string, url: string) => async (tx: import("@prisma/client").Prisma.TransactionClient) => {
  await tx.festivalPlaylist.upsert({
    where: { editionId_provider: { editionId, provider: "spotify" } },
    create: { editionId, provider: "spotify", url }, update: { url },
  });
  return url;
};

test("DB fence rejects wrong identities, expiry, reclaimed owners and commits new owner catalog writes", async () => {
  const { claim, editionId, slug } = await fencedFixture();
  const write = playlistWrite(editionId, `https://example.test/${randomUUID()}`);
  for (const changed of [{ festivalSlug: "wrong-festival" }, { publicationId: jobId }, { leaseOwner: ownerB }, { attempts: claim.attempts + 1 }]) {
    const wrong = { ...claim, ...changed };
    await assert.rejects(assertPlaylistRefreshLease(first, wrong), PlaylistLeaseLostError);
    await assert.rejects(commitPlaylistRefresh(first, wrong, write), PlaylistLeaseLostError);
    assert.equal(await finishPlaylistRefresh(first, wrong, "SUCCEEDED"), false);
  }
  await assertPlaylistRefreshLease(first, claim);
  // A forged future expiry cannot bypass DB time.
  await first.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { leaseExpiresAt: new Date(0) } });
  await assert.rejects(assertPlaylistRefreshLease(first, { ...claim, leaseExpiresAt: base }), PlaylistLeaseLostError);
  await assert.rejects(commitPlaylistRefresh(first, claim, write), PlaylistLeaseLostError);
  assert.equal(await finishPlaylistRefresh(first, claim, "SUCCEEDED"), false);
  // A new owner can commit; the old owner and old attempt cannot.
  const reclaimed = (await claimPage(second, { owner: ownerB, ttlMs: 60_000 })).claim!;
  assert.equal(reclaimed.id, claim.id);
  assert.equal(reclaimed.attempts, claim.attempts + 1);
  await assert.rejects(commitPlaylistRefresh(first, claim, write), PlaylistLeaseLostError);
  // Matching the new owner alone cannot authorize the original attempt.
  await assert.rejects(commitPlaylistRefresh(first, { ...claim, leaseOwner: ownerB }, write), PlaylistLeaseLostError);
  assert.equal(await first.festivalPlaylist.count({ where: { editionId } }), 0);
  const result = await commitPlaylistRefresh(second, reclaimed, async (tx, scope) => {
    assert.deepEqual(scope, { festivalSlug: slug, editionYear: 2027, publicationId: reclaimed.publicationId });
    return write(tx);
  });
  assert.equal((await first.festivalPlaylist.findUniqueOrThrow({ where: { editionId_provider: { editionId, provider: "spotify" } } })).url, result);
  const completed = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } });
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.leaseOwner, null);
  assert.equal(completed.leaseExpiresAt, null);
  assert.ok(completed.completedAt);
  await assert.rejects(commitPlaylistRefresh(first, reclaimed, async () => { assert.fail("repeat must not execute catalog writes"); }), PlaylistLeaseLostError);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "SUCCEEDED"), false);
  assert.deepEqual(await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } }), completed);
});

test("DB fence rolls back catalog writes on callback error and expiry during transaction", async () => {
  const { claim, editionId } = await fencedFixture();
  const write = playlistWrite(editionId, `https://example.test/${randomUUID()}`);
  await assert.rejects(commitPlaylistRefresh(first, claim, async (tx) => { await write(tx); throw new Error("write failed"); }), /write failed/);
  assert.equal(await first.festivalPlaylist.count({ where: { editionId } }), 0);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } })).status, "RUNNING");
  // Shorten only the test fixture's lease; the callback itself never mutates it.
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 second' WHERE id = ${claim.id}`;
  await assert.rejects(commitPlaylistRefresh(first, claim, async (tx) => {
    await write(tx);
    await tx.$queryRaw`SELECT 1 FROM pg_sleep(1.1)`;
  }), PlaylistLeaseLostError);
  assert.equal(await first.festivalPlaylist.count({ where: { editionId } }), 0);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } })).status, "RUNNING");
  await first.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { status: "SUCCEEDED" } });
});

test("DB fence serializes same-festival commit vs claimant and competing completion", async () => {
  const { claim, editionId } = await fencedFixture();
  let release!: () => void;
  let held!: () => void;
  const untilReleased = new Promise<void>((resolve) => { release = resolve; });
  const lockHeld = new Promise<void>((resolve) => { held = resolve; });
  const holding = commitPlaylistRefresh(first, claim, async (tx) => {
    await playlistWrite(editionId, `https://example.test/${randomUUID()}`)(tx);
    held();
    await untilReleased;
  });
  try {
    await lockHeld;
    // The shared festival lock prevents a claim during catalog commit.
    assert.equal((await claimPage(second, { owner: ownerB, ttlMs: 60_000 })).claim, null);
    const competing = finishPlaylistRefresh(second, claim, "FAILED");
    release();
    await holding;
    assert.equal(await competing, false);
    assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } })).status, "SUCCEEDED");
  } finally { release(); await holding; }
});

test("DB fence refuses unleased legacy RUNNING and any RUNNING sibling", async () => {
  const { claim, editionId, slug } = await fencedFixture();
  const legacyPublication = await first.catalogPublication.create({ data: {
    source: "ADMIN", sourceId: `playlist-fence-legacy:${randomUUID()}`, festivalSlug: slug,
    editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
  } });
  const legacy = await enqueuePlaylistRefresh(first, legacyPublication.id);
  await first.catalogPlaylistRefresh.update({ where: { id: legacy.id }, data: { status: "RUNNING", attempts: 1 } });
  await assert.rejects(assertPlaylistRefreshLease(first, claim), PlaylistLeaseLostError);
  await assert.rejects(renewPlaylistRefreshLease(first, claim, 60_000), PlaylistLeaseLostError);
  assert.equal(await finishPlaylistRefresh(first, claim, "SUCCEEDED"), false);
  await assert.rejects(commitPlaylistRefresh(first, claim, playlistWrite(editionId, "https://example.test/legacy")), PlaylistLeaseLostError);
  await first.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { status: "SUCCEEDED" } });
  const forged = { ...claim, id: legacy.id, publicationId: legacy.publicationId };
  await assert.rejects(assertPlaylistRefreshLease(first, forged), PlaylistLeaseLostError);
  await assert.rejects(renewPlaylistRefreshLease(first, forged, 60_000), PlaylistLeaseLostError);
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  // Partially populated legacy rows with an expired timestamp but no owner
  // must not be implicitly resurrected either.
  await first.catalogPlaylistRefresh.update({ where: { id: legacy.id }, data: { leaseExpiresAt: new Date(0) } });
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  assert.equal(await finishPlaylistRefresh(first, forged, "SUCCEEDED"), false);
  assert.equal(await first.festivalPlaylist.count({ where: { editionId } }), 0);
  // An owner without an expiry, or an expiry without startedAt, is incomplete.
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseOwner" = ${ownerA}, "leaseExpiresAt" = NULL,
    "startedAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '3 hours' WHERE id = ${legacy.id}`;
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second',
    "startedAt" = NULL WHERE id = ${legacy.id}`;
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  await first.catalogPlaylistRefresh.updateMany({ where: { festivalSlug: slug }, data: { status: "SUCCEEDED" } });
});

test("claim timestamps use DB time after the festival lock, ignoring extra client time", async () => {
  const publication = await first.catalogPublication.create({ data: {
    source: "ADMIN", sourceId: `playlist-clock:${randomUUID()}`, festivalSlug: `queue-clock-${randomUUID()}`,
    editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
  } });
  const job = await enqueuePlaylistRefresh(first, publication.id);
  let afterLock!: Date;
  const options = { owner: ownerA, ttlMs: 1_000, now: new Date(0) };
  const page = await claimPage(first, options, async () => {
    // A transaction-start clock would precede this timestamp by >1s.
    await second.$queryRaw`SELECT 1 FROM pg_sleep(1.1)`;
    const [stamp] = await second.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    afterLock = stamp.now;
  });
  assert.equal(page.claim?.id, job.id);
  const row = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: job.id } });
  assert.ok(row.startedAt! >= afterLock);
  assert.equal(row.updatedAt.getTime(), row.startedAt!.getTime());
  assert.equal(row.leaseExpiresAt!.getTime() - row.startedAt!.getTime(), 1_000);
  assert.equal(await finishPlaylistRefresh(first, page.claim!, "SUCCEEDED"), true);
});

test("renewal preserves attempt identity, extends from DB time, and serializes concurrent renewals", async () => {
  const { claim } = await fencedFixture(10_000);
  const initial = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } });
  for (const change of [{ leaseOwner: ownerB }, { attempts: claim.attempts + 1 }, { publicationId: jobId }, { festivalSlug: "wrong" }]) {
    await assert.rejects(renewPlaylistRefreshLease(second, { ...claim, ...change }, 60_000), PlaylistLeaseLostError);
  }
  const renewals = await Promise.all([
    renewPlaylistRefreshLease(first, claim, 60_000), renewPlaylistRefreshLease(second, claim, 120_000),
  ]);
  assert.ok(renewals.every((renewed) => renewed.leaseExpiresAt > claim.leaseExpiresAt));
  const row = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } });
  assert.equal(row.leaseExpiresAt!.getTime(), Math.max(...renewals.map((renewed) => renewed.leaseExpiresAt.getTime())));
  assert.ok(row.leaseExpiresAt!.getTime() - row.updatedAt.getTime() > 119_000);
  assert.ok(row.leaseExpiresAt!.getTime() - row.updatedAt.getTime() <= 120_000);
  assert.equal(row.startedAt!.getTime(), initial.startedAt!.getTime());
  assert.equal(row.attempts, initial.attempts);
  assert.equal(row.leaseOwner, initial.leaseOwner);
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  // The original handle remains valid: caller expiry is not authoritative.
  await assertPlaylistRefreshLease(first, claim);
  await expireLease(claim.id);
  await assert.rejects(renewPlaylistRefreshLease(first, claim, 60_000), PlaylistLeaseLostError);
  const reclaimed = (await claimPage(second, input(ownerB))).claim!;
  assert.equal(reclaimed.id, claim.id);
  assert.equal(reclaimed.attempts, claim.attempts + 1);
  await assert.rejects(renewPlaylistRefreshLease(first, claim, 60_000), PlaylistLeaseLostError);
  assert.equal(await finishPlaylistRefresh(first, claim, "SUCCEEDED"), false);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "SUCCEEDED"), true);
});

test("renewal checks live DB expiry after waiting for the festival and row locks", async () => {
  const { claim, slug } = await fencedFixture();
  let pending!: Promise<unknown>;
  await first.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(210, hashtext(${slug}))`;
    await tx.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '100 milliseconds' WHERE id = ${claim.id}`;
    pending = assert.rejects(renewPlaylistRefreshLease(second, claim, 60_000), PlaylistLeaseLostError);
    await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.2)`;
  });
  await pending;
  const reclaimed = (await claimPage(second, input(ownerB))).claim!;
  assert.equal(reclaimed.id, claim.id);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "SUCCEEDED"), true);
});

test("renewal caps expiry at two hours from startedAt and cannot restart that lifetime", async () => {
  const { claim, editionId } = await fencedFixture();
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "startedAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '119 minutes' WHERE id = ${claim.id}`;
  const aged = await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } });
  const renewed = await renewPlaylistRefreshLease(first, claim, 3_600_000);
  assert.equal(renewed.leaseExpiresAt.getTime(), aged.startedAt!.getTime() + 7_200_000);
  const again = await renewPlaylistRefreshLease(second, claim, 3_600_000);
  assert.equal(again.leaseExpiresAt.getTime(), renewed.leaseExpiresAt.getTime());
  // Even a future leaseExpiresAt cannot bypass the absolute lifetime.
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "startedAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '2 hours', "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 hour' WHERE id = ${claim.id}`;
  await assert.rejects(renewPlaylistRefreshLease(first, claim, 1_000), PlaylistLeaseLostError);
  await assert.rejects(assertPlaylistRefreshLease(first, claim), PlaylistLeaseLostError);
  await assert.rejects(commitPlaylistRefresh(first, claim, async () => { assert.fail("max lifetime must fence callback"); }), PlaylistLeaseLostError);
  assert.equal(await finishPlaylistRefresh(first, claim, "FAILED"), false);
  const reclaimed = (await claimPage(second, input(ownerB))).claim!;
  assert.equal(reclaimed.id, claim.id);
  assert.equal(reclaimed.attempts, claim.attempts + 1);
  await assert.rejects(commitPlaylistRefresh(first, claim, playlistWrite(editionId, "https://example.test/stale")), PlaylistLeaseLostError);
  assert.equal(await first.festivalPlaylist.count({ where: { editionId } }), 0);
  assert.equal(await finishPlaylistRefresh(second, reclaimed, "SUCCEEDED"), true);
});

test("maximum lifetime during callback rolls back catalog writes", async () => {
  const { claim, editionId } = await fencedFixture();
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "startedAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '2 hours' + interval '1 second' WHERE id = ${claim.id}`;
  await assert.rejects(commitPlaylistRefresh(first, claim, async (tx) => {
    await playlistWrite(editionId, "https://example.test/lifetime")(tx);
    await tx.$queryRaw`SELECT 1 FROM pg_sleep(1.1)`;
  }), PlaylistLeaseLostError);
  assert.equal(await first.festivalPlaylist.count({ where: { editionId } }), 0);
  assert.equal((await first.catalogPlaylistRefresh.findUniqueOrThrow({ where: { id: claim.id } })).status, "RUNNING");
  await first.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { status: "SUCCEEDED" } });
});

test("concurrent catalog completions execute one callback and repeats never report success", async () => {
  const { claim, editionId } = await fencedFixture();
  let calls = 0;
  const write = async (tx: import("@prisma/client").Prisma.TransactionClient) => {
    calls++;
    return playlistWrite(editionId, "https://example.test/once")(tx);
  };
  const results = await Promise.allSettled([
    commitPlaylistRefresh(first, claim, write), commitPlaylistRefresh(second, claim, write),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof PlaylistLeaseLostError);
  assert.equal(calls, 1);
  assert.equal(await finishPlaylistRefresh(first, claim, "SUCCEEDED"), false);
  await assert.rejects(commitPlaylistRefresh(second, claim, write), PlaylistLeaseLostError);
  assert.equal(calls, 1);
});

test("claim rechecks DB retry eligibility after the festival lock", async () => {
  const publication = await first.catalogPublication.create({ data: {
    source: "ADMIN", sourceId: `playlist-retry-clock:${randomUUID()}`, festivalSlug: `queue-retry-clock-${randomUUID()}`,
    editionYear: 2027, actorLabel: "test", fields: ["lineup"], lineupChanged: true,
  } });
  const job = await enqueuePlaylistRefresh(first, publication.id);
  const page = await claimPage(first, input(ownerA), async () => {
    await second.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET status = 'FAILED',
      "retryAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 hour' WHERE id = ${job.id}`;
  });
  assert.equal(page.claim, null);
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  await first.$executeRaw`UPDATE "CatalogPlaylistRefresh" SET "retryAt" = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${job.id}`;
  const claim = (await claimPage(second, input(ownerB))).claim!;
  assert.equal(claim.id, job.id);
  assert.equal(await finishPlaylistRefresh(second, claim, "SUCCEEDED"), true);
});

test("persisted publication/festival mismatch blocks renewal, completion and fresh claim", async () => {
  const { claim } = await fencedFixture();
  const slug = `queue-mismatch-${randomUUID()}`;
  await first.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { festivalSlug: slug } });
  const mismatched = { ...claim, festivalSlug: slug };
  await assert.rejects(renewPlaylistRefreshLease(first, mismatched, 60_000), PlaylistLeaseLostError);
  await assert.rejects(commitPlaylistRefresh(first, mismatched, async () => { assert.fail("mismatch must fence writes"); }), PlaylistLeaseLostError);
  assert.equal(await finishPlaylistRefresh(first, mismatched, "SUCCEEDED"), false);
  await expireLease(claim.id);
  assert.equal((await claimPage(second, input(ownerB))).claim, null);
  await first.catalogPlaylistRefresh.update({ where: { id: claim.id }, data: { status: "SUCCEEDED" } });
});
