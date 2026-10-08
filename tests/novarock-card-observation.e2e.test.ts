import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { novaDraftFixture } from "./support/novarock-review-draft-fixture.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";
import { captureAcquisitionProvenance } from "../lib/ingestion/provenance.ts";
import { createIngestionRun, persistAttempt, finishIngestionRun } from "../lib/ingestion/repository.ts";
import { sealNovaRockContent } from "../lib/ingestion/novarock-content-seal.ts";
import { readFileSync } from "node:fs";
import { verifyNovaRockCardObservation } from "../lib/ingestion/novarock-card-observation.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
async function bounded<T>(promise: Promise<T>) {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Race barrier deadline exceeded")), 5000);
  })]); } finally { clearTimeout(timer); }
}
async function blocked(waiter: number, holder: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT ${holder}::int = ANY(pg_blocking_pids(${waiter}::int)) AS blocked`;
    if (row.blocked) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Expected PostgreSQL lock wait not observed");
}
const serialFailure = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001"));
// Synthetic records only. Never seed review decisions. Discard DB, retain seal history.
test("real PostgreSQL: non-authorizing card bytes, fresh replay, races and zero publication writes", { timeout: 60000 }, async (t) => {
  try {
    const fixture = novaDraftFixture();
    // Migrations seed unrelated Midgardsblot rows. Guard only this suite's exact
    // Nova namespace, retaining all migrated rows in global before/after checks.
    assert.equal(await db.ingestionAttempt.count({ where: { festivalSlug: "nova-rock" } }), 0, "requires no existing Nova attempts");
    assert.equal(await db.festival.count({ where: { OR: [{ slug: "nova-rock" }, { id: fixture.festival.id }] } }), 0, "Nova festival fixture must not exist");
    assert.equal(await db.festivalEdition.count({ where: { id: fixture.edition.id } }), 0, "exact Nova edition must not exist");
    assert.equal(await db.festivalSource.count({ where: { OR: [{ id: fixture.draft.sourceId }, { festivalSlug: "nova-rock" }] } }), 0, "Nova source fixture must not exist");
    assert.equal(await db.artist.count({ where: { OR: [
      { id: { in: fixture.artists.map((a) => a.id) } }, { slug: { in: fixture.artists.map((a) => a.slug) } },
    ] } }), 0, "synthetic artist fixtures must not exist");
    await db.festival.create({ data: fixture.festival });
    await db.festivalEdition.create({ data: fixture.edition });
    for (const { identities: _identities, links: _links, provenance: _provenance, ...a } of fixture.artists) await db.artist.create({ data: a });
    await db.lineupEntry.createMany({ data: fixture.lineup });
    const source = await db.festivalSource.create({ data: {
      id: fixture.draft.sourceId, festivalId: fixture.festival.id, festivalSlug: "nova-rock", editionId: fixture.edition.id, editionYear: 2027,
      url: "https://www.novarock.at/lineup/", parserKey: "official_markup:nova-rock", strategies: ["official_markup"], refreshPolicy: "daily",
      cadenceSeconds: 86400, configurationGeneration: 1, leaseVersion: 1, configurationBackfilledAt: new Date("2026-10-08T00:00:00Z"),
    }, include: { edition: true } });
    const provenance = captureAcquisitionProvenance({ ...source, leaseOwner: "12345678-1234-4234-8234-123456789012" });
    const { result } = novaContentFixture();
    const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-unattested", totalSources: 1 });
    const input = { runId: run.id, festivalSlug: "nova-rock", requestedUrl: source.url, finalUrl: source.url,
      httpStatus: 200, durationMs: 1, startedAt: new Date("2026-10-08T00:00:00Z"), endedAt: new Date("2026-10-08T00:00:01Z"), acquisitionProvenance: provenance };
    const attempt = await persistAttempt(db, { ...input, result });
    await finishIngestionRun(db, run.id);
    const candidate = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
    const seal = await sealNovaRockContent(db, candidate.id);
    const binding = { sealId: seal.id, candidateId: candidate.id, contentDigest: seal.contentDigest };
    const bytes = readFileSync(new URL("./fixtures/official-markup/novarock-lineup-2027.html", import.meta.url));
    const observe = (client = db) => verifyNovaRockCardObservation(client, binding, bytes);
    const edition = fixture.edition;
    async function catalogue() {
      return json({ festival: await db.festival.findMany({ orderBy: { id: "asc" } }), edition: await db.festivalEdition.findMany({ orderBy: { id: "asc" } }), lineup: await db.lineupEntry.findMany({ orderBy: { id: "asc" } }),
        artists: await db.artist.findMany({ orderBy: { id: "asc" } }), publications: await db.catalogPublication.count(), queues: await db.catalogPlaylistRefresh.count(),
        playlists: await db.festivalPlaylist.count(), festivalCount: await db.festival.count(), editionCount: await db.festivalEdition.count(),
        artistCount: await db.artist.count(), lineupCount: await db.lineupEntry.count() });
    }
    const before = await catalogue();
    const valid = await observe();
    assert.equal(valid.authority, "NONE");
    assert.equal(valid.cards.length, 44);
    assert.deepEqual(valid.dayCounts, [8, 14, 10, 12]);
    await t.test("replay and simultaneous reads never authorize", async () => {
      assert.deepEqual(await observe(), valid);
      const outcomes = await Promise.allSettled([observe(), observe()]);
      assert.ok(outcomes.some((o) => o.status === "fulfilled"));
      for (const o of outcomes) {
        if (o.status === "fulfilled") assert.deepEqual(o.value, valid);
        else assert.ok(serialFailure(o.reason));
      }
      assert.deepEqual(await catalogue(), before);
    });
    await t.test("substituted binding and late caption fail", async () => {
      await assert.rejects(verifyNovaRockCardObservation(db, { ...binding, contentDigest: "f".repeat(64) }, bytes), /substituted/);
      await assert.rejects(verifyNovaRockCardObservation(db, binding, Buffer.from(bytes.toString().replace(">Dame<", ">Other<"))), /sealed bill/);
    });
    await t.test("source drift and swap-away/back fail without resetting generation", async () => {
      const rollback = new Error("synthetic rollback");
      for (const data of [{ enabled: false }, { leaseVersion: source.leaseVersion + 1 },
        { leaseOwner: provenance.leaseOwner, leaseExpiresAt: new Date(Date.now() + 10000) },
        { requestHeaders: { "x-extra": "untrusted" } }, { cadenceSeconds: source.cadenceSeconds! + 1 }]) {
        await assert.rejects(db.$transaction(async (tx) => {
          await tx.festivalSource.update({ where: { id: source.id }, data });
          const client = { $transaction: async (fn: (inner: Prisma.TransactionClient) => Promise<unknown>, options: any) => {
            assert.equal(options.isolationLevel, "Serializable"); return fn(tx);
          } } as unknown as PrismaClient;
          await assert.rejects(observe(client), /stale/);
          throw rollback;
        }, { isolationLevel: "Serializable", timeout: 10000 }), (e) => e === rollback);
      }
      await assert.rejects(db.$transaction(async (tx) => {
        await tx.festivalSource.update({ where: { id: source.id }, data: { url: "https://www.novarock.at/" } });
        const back = await tx.festivalSource.update({ where: { id: source.id }, data: { url: source.url } });
        assert.equal(back.configurationGeneration, source.configurationGeneration + 2);
        const client = { $transaction: async (fn: (inner: Prisma.TransactionClient) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
        await assert.rejects(observe(client), /stale/); throw rollback;
      }, { isolationLevel: "Serializable", timeout: 10000 }), (e) => e === rollback);
      assert.deepEqual(await observe(), valid);
    });
    await t.test("candidate lifecycle cannot authorize this observation", async () => {
      const rollback = new Error("synthetic lifecycle rollback");
      await assert.rejects(db.$transaction(async (tx) => {
        await tx.ingestionCandidate.update({ where: { id: candidate.id }, data: { reviewState: "APPROVED" } });
        const client = { $transaction: async (fn: (inner: Prisma.TransactionClient) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
        await assert.rejects(observe(client), /stale/); throw rollback;
      }, { isolationLevel: "Serializable", timeout: 10000 }), (e) => e === rollback);
      assert.deepEqual(await observe(), valid);
    });
    await t.test("competing enabled source rejected", async () => {
      const extra = await db.festivalSource.create({ data: {
        id: "synthetic-competing-observation-source", festivalId: fixture.festival.id, festivalSlug: "nova-rock",
        editionYear: 2027, editionId: fixture.edition.id, url: "https://www.novarock.at/", strategies: ["official_markup"],
        refreshPolicy: "daily", enabled: true, parserKey: "official_markup:nova-rock", cadenceSeconds: 86400,
        configurationBackfilledAt: source.configurationBackfilledAt,
      } });
      try { await assert.rejects(observe(), /competing/); }
      finally { await db.festivalSource.delete({ where: { id: extra.id } }); }
      assert.deepEqual(await observe(), valid);
    });
    // Instrument actual transactions only; never substitute PostgreSQL rows or locks.
    // Edition race is reversible. The final source race advances generation for
    // good: restoring the actual config must leave the old sealed observation stale.
    for (const target of ["edition", "source"] as const) await t.test(`writer-first ${target} race fails on stale Serializable snapshot`, { timeout: 15000 }, async () => {
      const holding = deferred<number>(), release = deferred<void>(), reading = deferred<number>();
      const writer = db.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (target === "source") {
          const changed = await tx.festivalSource.update({ where: { id: source.id }, data: { cadenceSeconds: source.cadenceSeconds! + 1 } });
          assert.equal(changed.configurationGeneration, source.configurationGeneration + 1);
        }
        else await tx.festivalEdition.update({ where: { id: edition.id }, data: { startDate: new Date("2027-06-11") } });
        holding.resolve(pid); await bounded(release.promise);
      }, { isolationLevel: "Serializable", timeout: 10000 });
      void writer.catch(() => {}); // Attach immediately; awaited below and settled in finally.
      let validation: Promise<unknown> | undefined;
      try {
        const writerPid = await bounded(holding.promise);
        const instrumented = { $transaction: async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options: any) => {
          assert.equal(options.isolationLevel, "Serializable");
          return db.$transaction(async (tx) => {
            const [isolation] = await tx.$queryRawUnsafe<{ transaction_isolation: string }[]>("SHOW transaction_isolation");
            assert.equal(isolation.transaction_isolation, "serializable");
            // Establish the pre-commit snapshot before the application's first source lock.
            await tx.festivalSource.count();
            const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            reading.resolve(pid); return fn(tx);
          }, options);
        } } as unknown as PrismaClient;
        validation = observe(instrumented);
        // Attach rejection handling while the application waits for the competing lock.
        const rejected = assert.rejects(validation, serialFailure);
        await blocked(await bounded(reading.promise), writerPid);
        release.resolve(); await writer; await rejected;
      } finally {
        release.resolve(); await Promise.allSettled([writer, ...(validation ? [validation] : [])]);
        if (target === "source") await db.festivalSource.update({ where: { id: source.id }, data: { cadenceSeconds: source.cadenceSeconds } });
        else await db.festivalEdition.update({ where: { id: edition.id }, data: { startDate: edition.startDate, updatedAt: edition.updatedAt } });
      }
      assert.deepEqual(await catalogue(), before);
      if (target === "source") {
        const restored = await db.festivalSource.findUniqueOrThrow({ where: { id: source.id } });
        assert.equal(restored.cadenceSeconds, source.cadenceSeconds);
        assert.equal(restored.configurationGeneration, source.configurationGeneration + 2);
        await assert.rejects(observe(), /stale/, "fresh retry cannot adopt a newer configuration generation");
      } else assert.deepEqual(await observe(), valid, "fresh read retry only");
    });
    assert.deepEqual(await catalogue(), before);
    await t.test("newer failed attempt invalidates the sealed observation", async () => {
      const later = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-unattested", totalSources: 1 });
      await persistAttempt(db, { ...input, runId: later.id, endedAt: new Date("2026-10-08T00:00:02Z"), error: "synthetic newer failure" });
      await assert.rejects(observe(), /Historical/);
    });
    assert.deepEqual(await catalogue(), before);
    assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).reviewState, "PENDING");
    assert.equal((await db.ingestionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, "REVIEW");
    assert.equal(await db.novaRockContentSeal.count(), 1);
  } finally { await db.$disconnect(); }
});
