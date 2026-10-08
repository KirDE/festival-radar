import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";
import { createIngestionRun, persistAttempt, finishIngestionRun } from "../lib/ingestion/repository.ts";
import { sealNovaRockContent, verifyNovaRockContentSeal } from "../lib/ingestion/novarock-content-seal.ts";

// This suite needs its own NEW empty migrated localhost DB. Never shares the sequential suite's DB.
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
type Tx = Prisma.TransactionClient;
const deadlineMs = 5000;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, wait: () => bounded(promise) };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Concurrency barrier timed out")), deadlineMs);
    })]);
  } finally { clearTimeout(timer); }
}
function pause() { return { reached: deferred<number>(), release: deferred<void>() }; }
async function pid(tx: Tx) {
  const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}
async function isolation(tx: Tx) {
  const [row] = await tx.$queryRawUnsafe<{ transaction_isolation: string }[]>("SHOW transaction_isolation");
  assert.equal(row.transaction_isolation, "serializable", "real PostgreSQL isolation, not only Prisma options");
}
// Observe the actual blocked backend; scheduling never depends on a fixed delay.
async function blocked(waiter: number, holder: number) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT ${holder}::int = ANY(pg_blocking_pids(${waiter}::int)) AS blocked`;
    if (row.blocked) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Expected PostgreSQL lock wait was not observed");
}

/** Test-only transaction instrumentation. All reads/writes/locks are real Prisma/PostgreSQL;
 * the public implementation and its supplied isolation/timeout options are unchanged. */
function pausedApplication(stage: "initial-read" | "seal-insert", gate: ReturnType<typeof pause>) {
  return { $transaction: async (fn: (tx: Tx) => Promise<unknown>, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    return db.$transaction(async (tx) => {
      await isolation(tx);
      const backend = await pid(tx);
      const intercept = (model: any, method: string, shouldPause: (args: any) => boolean) => new Proxy(model, {
        get(target, key) {
          const member = Reflect.get(target, key);
          if (key === method) return async (args: any) => {
            const result = await member.call(target, args);
            if (shouldPause(args)) { gate.reached.resolve(backend); await gate.release.wait(); }
            return result;
          };
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      const instrumented = new Proxy(tx, {
        get(target, key) {
          if (stage === "initial-read" && key === "ingestionCandidate") return intercept(tx.ingestionCandidate, "findUniqueOrThrow", (args) => !!args.select);
          if (stage === "seal-insert" && key === "novaRockContentSeal") return intercept(tx.novaRockContentSeal, "create", () => true);
          const member = Reflect.get(target, key);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      return fn(instrumented);
    }, options);
  } } as unknown as PrismaClient;
}
const settled = <T>(promise: Promise<T>) => promise.then(
  (value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }),
);
function serialization(error: unknown) {
  const e = error as { code?: string; meta?: { code?: string } };
  // Prisma raw-query failures preserve SQLSTATE separately from ORM transaction conflicts.
  return e.code === "P2034" || (e.code === "P2010" && e.meta?.code === "40001");
}
function refused(error: unknown) { return serialization(error) || /sealed content is immutable/.test(String(error)); }
let sequence = 0;
async function fixture() {
  const { result, provenance } = novaContentFixture();
  const endedAt = new Date(Date.UTC(2026, 9, 8) + ++sequence * 1000);
  const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-concurrency", totalSources: 1 });
  const attempt = await persistAttempt(db, { runId: run.id, festivalSlug: "nova-rock", requestedUrl: provenance.configuration.url,
    finalUrl: provenance.configuration.url, httpStatus: 200, durationMs: 1, startedAt: endedAt, endedAt, acquisitionProvenance: provenance, result });
  await finishIngestionRun(db, run.id);
  return db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id }, include: { evidence: true, diffs: true } });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Mutation = (tx: Tx, c: Fixture) => Promise<unknown>;
function childMutation(table: "evidence" | "diff", operation: "INSERT" | "UPDATE" | "DELETE"): Mutation {
  return async (tx, c) => {
    if (table === "evidence") {
      const { id, ...data } = c.evidence.find((e) => e.field === "lineup")!;
      if (operation === "INSERT") return tx.ingestionEvidence.create({ data: { ...data, observedValue: data.observedValue as Prisma.InputJsonValue } });
      if (operation === "UPDATE") return tx.ingestionEvidence.update({ where: { id }, data: { observedValue: ["changed-later-card"] } });
      return tx.ingestionEvidence.delete({ where: { id } });
    }
    const { id, ...data } = c.diffs[0];
    if (operation === "INSERT") return tx.ingestionDiff.create({ data: { ...data, beforeValue: data.beforeValue === null ? Prisma.JsonNull : data.beforeValue as Prisma.InputJsonValue,
      afterValue: data.afterValue === null ? Prisma.JsonNull : data.afterValue as Prisma.InputJsonValue } });
    if (operation === "UPDATE") return tx.ingestionDiff.update({ where: { id }, data: { reviewRequired: !data.reviewRequired } });
    return tx.ingestionDiff.delete({ where: { id } });
  };
}
async function rows(c: Fixture) {
  return { candidate: await db.ingestionCandidate.findUniqueOrThrow({ where: { id: c.id } }),
    evidence: await db.ingestionEvidence.findMany({ where: { candidateId: c.id }, orderBy: { id: "asc" } }),
    diffs: await db.ingestionDiff.findMany({ where: { candidateId: c.id }, orderBy: { id: "asc" } }) };
}

async function race(order: "seal-first" | "writer-first", mutate: Mutation) {
  const c = await fixture();
  const before = await rows(c);
  const gate = pause();
  const writerReady = deferred<number>();
  const writerRelease = deferred<void>();
  let sealPromise: ReturnType<typeof settled<Awaited<ReturnType<typeof sealNovaRockContent>>>> | undefined;
  let writerPromise: ReturnType<typeof settled<unknown>> | undefined;
  try {
    if (order === "seal-first") {
      sealPromise = settled(sealNovaRockContent(pausedApplication("seal-insert", gate), c.id));
      const sealPid = await gate.reached.wait();
      writerPromise = settled(db.$transaction(async (tx) => {
        await isolation(tx);
        // Force the competing writer's snapshot to predate the uncommitted seal.
        assert.equal(await tx.novaRockContentSeal.count({ where: { candidateId: c.id } }), 0);
        writerReady.resolve(await pid(tx));
        return mutate(tx, c); // Trigger must wait for the candidate lock held by the seal.
      }, { isolationLevel: "Serializable", timeout: 10000 }));
      const writerPid = await writerReady.wait();
      await blocked(writerPid, sealPid);
      gate.release.resolve();
      const seal = await sealPromise;
      assert.ok(seal.ok, seal.ok ? "" : String(seal.error));
      const writer = await writerPromise;
      assert.ok(!writer.ok, "stale writer must not commit after the seal");
      if (!writer.ok) assert.ok(refused(writer.error), String(writer.error));
      assert.deepEqual(await rows(c), before, "failed writer rolls back every content/lifecycle change");
      assert.equal((await verifyNovaRockContentSeal(db, seal.value.id)).authority, "NONE");
    } else {
      writerPromise = settled(db.$transaction(async (tx) => {
        await isolation(tx);
        await mutate(tx, c); // Its trigger holds the candidate lock until commit.
        writerReady.resolve(await pid(tx));
        await writerRelease.wait();
      }, { isolationLevel: "Serializable", timeout: 10000 }));
      const writerPid = await writerReady.wait();
      sealPromise = settled(sealNovaRockContent(pausedApplication("initial-read", gate), c.id));
      const sealPid = await gate.reached.wait();
      gate.release.resolve();
      await blocked(sealPid, writerPid);
      writerRelease.resolve();
      const writer = await writerPromise;
      assert.ok(writer.ok, writer.ok ? "" : String(writer.error));
      const seal = await sealPromise;
      assert.ok(!seal.ok, "a pre-mutation snapshot must not become a valid seal");
      if (!seal.ok) assert.ok(serialization(seal.error), String(seal.error));
      assert.equal(await db.novaRockContentSeal.count({ where: { candidateId: c.id } }), 0);
      assert.notDeepEqual(await rows(c), before, "only the winning unsealed writer committed");
    }
  } finally {
    gate.release.resolve(); writerRelease.resolve();
    await Promise.all([sealPromise, writerPromise]); // No abandoned transaction after a failed barrier/assertion.
  }
}

test("Nova content seal PostgreSQL races (isolated empty DB, no authority)", { timeout: 120000 }, async (t) => {
  try {
    assert.equal(await db.ingestionAttempt.count(), 0, "requires NEW empty migrated disposable DB");
    assert.equal(await db.ingestionRun.count(), 0);
    assert.equal(await db.novaRockContentSeal.count(), 0);
    const publications = await db.catalogPublication.count();
    const queues = await db.catalogPlaylistRefresh.count();
    for (const table of ["evidence", "diff"] as const) for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
      for (const order of ["seal-first", "writer-first"] as const) await t.test(`${table} ${operation}: ${order}`, { timeout: 15000 }, async () => {
        await race(order, childMutation(table, operation));
      });
    }
    const mixed: Mutation = (tx, c) => tx.ingestionCandidate.update({ where: { id: c.id }, data: {
      reviewActor: "untrusted-concurrency-text", warnings: ["changed-warning"],
      normalized: { ...(c.normalized as Prisma.JsonObject), warnings: ["changed-warning"] },
    } });
    for (const order of ["seal-first", "writer-first"] as const) await t.test(`mixed lifecycle/content UPDATE: ${order}`, { timeout: 15000 }, async () => {
      await race(order, mixed);
    });
    await t.test("real Serializable failure propagates; fresh retry remains authority NONE", { timeout: 15000 }, async () => {
      const c = await fixture();
      const gate = pause();
      const attempt = settled(sealNovaRockContent(pausedApplication("initial-read", gate), c.id));
      try {
        await gate.reached.wait();
        // Changes the candidate tuple after the application's snapshot, before FOR UPDATE.
        await db.ingestionCandidate.update({ where: { id: c.id }, data: { reviewActor: "untrusted-retry-text" } });
        gate.release.resolve();
        const outcome = await attempt;
        assert.ok(!outcome.ok, "serialization error must propagate, never silently retry/fallback");
        if (!outcome.ok) assert.ok(serialization(outcome.error), String(outcome.error));
        assert.equal(await db.novaRockContentSeal.count({ where: { candidateId: c.id } }), 0);
        assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { id: c.id } })).reviewState, "PENDING");
        const seal = await sealNovaRockContent(db, c.id); // Explicit new transaction/snapshot only.
        assert.equal((await verifyNovaRockContentSeal(db, seal.id)).authority, "NONE");
      } finally { gate.release.resolve(); await attempt; }
    });
    assert.equal(await db.catalogPublication.count(), publications);
    assert.equal(await db.catalogPlaylistRefresh.count(), queues);
  } finally { await db.$disconnect(); }
});
