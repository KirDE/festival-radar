import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { claimDueSourceIds, claimDueSources, completeSourceLease, renewSourceLease, startSourceLeaseRenewal } from "../lib/ingestion/lease.ts";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("A disposable test/integration DATABASE_URL is required");
const first = new PrismaClient();
const second = new PrismaClient();
const slug = "lease-fixture-" + randomUUID().slice(0, 8);
const base = new Date("2027-03-01T00:00:00.000Z");
const ownerA = randomUUID();
const ownerB = randomUUID();
let id: string;

const options = (owner: string, now = base) => ({ owner, now, limit: 1, ttlMs: 60_000 });
test.before(async () => {
  const festival = await first.festival.create({ data: {
    slug, name: "Lease Fixture", country: "Test", countryCode: "DE", officialUrl: "https://example.test/lease", genres: [],
    editions: { create: { year: 2027, status: "TBA", ticketStatus: "UNKNOWN", recordState: "TRACKING", completeness: "TBA", sourceUpdatedAt: base } },
  } });
  const edition = await first.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id } });
  const source = await first.festivalSource.create({ data: {
    festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: "https://example.test/lease",
    strategies: ["manual_review"], parserKey: "manual_review", refreshPolicy: "daily", cadenceSeconds: 86400,
    enabled: true, editionYear: 2027, configurationBackfilledAt: base,
  } });
  id = source.id;
});
test.after(async () => {
  await first.festivalSource.deleteMany({ where: { festivalSlug: slug } });
  await first.festival.delete({ where: { slug } });
  await Promise.all([first.$disconnect(), second.$disconnect()]);
});

test("atomic claim excludes concurrent workers and fenced completion schedules next run", async () => {
  const [a, b] = await Promise.all([claimDueSourceIds(first, options(ownerA)), claimDueSourceIds(second, options(ownerB))]);
  assert.equal(a.length + b.length, 1);
  assert.equal([...a, ...b][0], id);
  const winner = a.length ? ownerA : ownerB;
  const loser = a.length ? ownerB : ownerA;
  const claimed = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(await completeSourceLease(first, { id, owner: loser, now: base, updatedAt: claimed.updatedAt, outcome: "success" }), false);
  assert.equal(await completeSourceLease(first, { id, owner: winner, now: base, updatedAt: claimed.updatedAt, outcome: "fetch_error" }), true);
  const failed = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.lastError, "fetch_error");
  assert.equal(failed.nextRunAt?.toISOString(), "2027-03-01T00:05:00.000Z");
  assert.deepEqual(await claimDueSourceIds(second, options(ownerB, new Date("2027-03-01T00:04:59.000Z"))), []);
  assert.deepEqual(await claimDueSourceIds(second, options(ownerB, failed.nextRunAt!)), [id]);
  const reclaimed = await second.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(await completeSourceLease(second, { id, owner: ownerB, now: failed.nextRunAt!, updatedAt: reclaimed.updatedAt, outcome: "success" }), true);
  const completed = await second.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(completed.consecutiveFailures, 0);
  assert.equal(completed.lastError, null);
  assert.equal(completed.nextRunAt?.toISOString(), "2027-03-02T00:05:00.000Z");
});

test("expired lease can be reclaimed but old worker cannot acknowledge", async () => {
  await first.festivalSource.update({ where: { id }, data: { nextRunAt: base, leaseOwner: null, leaseExpiresAt: null } });
  assert.deepEqual(await claimDueSourceIds(first, options(ownerA)), [id]);
  const firstClaim = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  const afterExpiry = new Date("2027-03-01T00:01:01.000Z");
  assert.deepEqual(await claimDueSourceIds(second, options(ownerB, afterExpiry)), [id]);
  const secondClaim = await second.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(await completeSourceLease(first, { id, owner: ownerA, now: afterExpiry, updatedAt: firstClaim.updatedAt, outcome: "success" }), false);
  assert.equal(await completeSourceLease(second, { id, owner: ownerB, now: afterExpiry, updatedAt: secondClaim.updatedAt, outcome: "parser_error" }), true);
  const row = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(row.consecutiveFailures, 1);
  assert.equal(row.lastError, "parser_error");
  assert.equal(row.nextRunAt?.toISOString(), "2027-03-01T00:06:01.000Z");
});

test("operator source edits prevent old worker schedule updates", async () => {
  await first.festivalSource.update({ where: { id }, data: { enabled: true, parserKey: "manual_review", nextRunAt: base, leaseOwner: null, leaseExpiresAt: null } });
  assert.deepEqual(await claimDueSourceIds(first, options(ownerA)), [id]);
  const claimed = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  const rescheduled = await second.festivalSource.update({ where: { id }, data: { nextRunAt: new Date("2027-04-01T00:00:00.000Z"), updatedAt: new Date("2030-01-01T00:00:00.000Z") } });
  assert.equal(await completeSourceLease(first, { id, owner: ownerA, now: base, updatedAt: claimed.updatedAt, outcome: "success" }), false);
  assert.deepEqual(await first.festivalSource.findUniqueOrThrow({ where: { id } }), rescheduled);
  const disabled = await second.festivalSource.update({ where: { id }, data: { enabled: false, updatedAt: new Date("2031-01-01T00:00:00.000Z") } });
  assert.equal(await completeSourceLease(first, { id, owner: ownerA, now: base, updatedAt: rescheduled.updatedAt, outcome: "fetch_error" }), false);
  assert.deepEqual(await first.festivalSource.findUniqueOrThrow({ where: { id } }), disabled);
});

test("invalid claim arguments fail before database access", async () => {
  const unavailable = { $queryRaw: () => { throw new Error("database accessed"); } } as unknown as PrismaClient;
  await assert.rejects(claimDueSourceIds(unavailable, { ...options(ownerA), limit: 0 }), /Invalid ingestion batch size/);
  await assert.rejects(claimDueSourceIds(unavailable, options("not-a-uuid")), /Invalid ingestion lease owner/);
  await assert.rejects(claimDueSourceIds(unavailable, { ...options(ownerA), ttlMs: 1 }), /Invalid ingestion lease duration/);
});

test("disabled and unconfigured rows cannot be claimed", async () => {
  await first.festivalSource.update({ where: { id }, data: { enabled: false, nextRunAt: base, leaseOwner: null, leaseExpiresAt: null } });
  assert.deepEqual(await claimDueSourceIds(first, options(ownerA)), []);
  await first.festivalSource.update({ where: { id }, data: { enabled: true, parserKey: null } });
  assert.deepEqual(await claimDueSourceIds(second, options(ownerB)), []);
});

test("claim returns the exact revision used by publication and completion fences", async () => {
  await first.festivalSource.update({ where: { id }, data: { enabled: true, parserKey: "manual_review", nextRunAt: base, leaseOwner: null, leaseExpiresAt: null } });
  const [claim] = await claimDueSources(first, options(ownerA));
  assert.equal(claim.id, id);
  const row = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(claim.updatedAt.toISOString(), row.updatedAt.toISOString());
  assert.equal(await completeSourceLease(first, { ...claim, owner: ownerA, now: base, outcome: "success" }), true);
});


test("renewal preserves revision/configuration and fails closed on expiry, reclaim and edit", async () => {
  const now = new Date();
  await first.festivalSource.update({ where: { id }, data: { enabled: true, parserKey: "manual_review", nextRunAt: now, leaseOwner: null, leaseExpiresAt: null } });
  const [claim] = await claimDueSources(first, options(ownerA, now));
  assert.equal(claim.id, id);
  const before = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(await renewSourceLease(first, { ...claim, owner: ownerB }, 30_000), false);
  assert.equal(await renewSourceLease(first, { ...claim, owner: ownerA }, 30_000), true);
  const renewed = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(renewed.updatedAt.getTime(), claim.updatedAt.getTime());
  assert.equal(renewed.url, before.url);
  assert.equal(renewed.nextRunAt?.getTime(), before.nextRunAt?.getTime());
  assert.equal(renewed.leaseOwner, ownerA);
  assert.ok(renewed.leaseExpiresAt! > new Date());
  await first.$executeRaw`UPDATE "FestivalSource" SET "leaseExpiresAt" = ${new Date(Date.now() - 1000)} WHERE id = ${id}`;
  const expired = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(await renewSourceLease(first, { ...claim, owner: ownerA }, 30_000), false);
  assert.deepEqual(await first.festivalSource.findUniqueOrThrow({ where: { id } }), expired);
  const [reclaim] = await claimDueSources(second, options(ownerB, new Date()));
  assert.equal(reclaim.id, id);
  const ownedByB = await second.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(await renewSourceLease(first, { ...claim, owner: ownerA }, 30_000), false);
  assert.deepEqual(await first.festivalSource.findUniqueOrThrow({ where: { id } }), ownedByB);
  const edited = await second.festivalSource.update({ where: { id }, data: { cadenceSeconds: 172800, updatedAt: new Date(Date.now() + 60_000) } });
  assert.equal(await renewSourceLease(first, { ...reclaim, owner: ownerB }, 30_000), false);
  assert.deepEqual(await first.festivalSource.findUniqueOrThrow({ where: { id } }), edited);
});

test("concurrent edit holding a row lock prevents the queued renewal from changing it", async () => {
  const now = new Date();
  await first.festivalSource.update({ where: { id }, data: { enabled: true, parserKey: "manual_review", nextRunAt: now, leaseOwner: null, leaseExpiresAt: null } });
  const [claim] = await claimDueSources(first, options(ownerA, now));
  let release!: () => void;
  let locked!: () => void;
  const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const editing = second.$transaction(async (tx) => {
    await tx.festivalSource.update({ where: { id }, data: { parserKey: "json_ld_event", updatedAt: new Date(Date.now() + 60_000) } });
    locked();
    await releasePromise;
  });
  await lockedPromise;
  const renewing = renewSourceLease(first, { ...claim, owner: ownerA }, 30_000);
  release();
  await editing;
  assert.equal(await renewing, false);
  const row = await first.festivalSource.findUniqueOrThrow({ where: { id } });
  assert.equal(row.parserKey, "json_ld_event");
  assert.equal(row.leaseExpiresAt?.getTime(), now.getTime() + 60_000);
});

test("heartbeat extends a shortened lease during asynchronous work and detects stolen ownership", async () => {
  const now = new Date();
  await first.festivalSource.update({ where: { id }, data: { enabled: true, parserKey: "manual_review", nextRunAt: now, leaseOwner: null, leaseExpiresAt: null } });
  const [claim] = await claimDueSources(first, options(ownerA, now));
  await first.$executeRaw`UPDATE "FestivalSource" SET "leaseExpiresAt" = ${new Date(Date.now() + 200)} WHERE id = ${id}`;
  const heartbeat = startSourceLeaseRenewal(first, { ...claim, owner: ownerA }, { intervalMs: 30, ttlMs: 30_000 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 90));
    heartbeat.assertActive();
    const renewed = await first.festivalSource.findUniqueOrThrow({ where: { id } });
    assert.ok(renewed.leaseExpiresAt! > new Date(Date.now() + 20_000));
    assert.equal(renewed.updatedAt.getTime(), claim.updatedAt.getTime());
    await second.festivalSource.update({ where: { id }, data: { leaseOwner: ownerB } });
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.throws(() => heartbeat.assertActive(), /renewal failed/);
    await assert.rejects(heartbeat.stop(), /renewal failed/);
  } finally { try { await heartbeat.stop(); } catch { /* expected after takeover */ } }
});
