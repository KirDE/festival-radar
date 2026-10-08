import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { novaDraftFixture } from "./support/novarock-review-draft-fixture.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";
import { captureAcquisitionProvenance } from "../lib/ingestion/provenance.ts";
import { createIngestionRun, persistAttempt, finishIngestionRun } from "../lib/ingestion/repository.ts";
import { sealNovaRockContent } from "../lib/ingestion/novarock-content-seal.ts";
import { novaRockDraftBaseline, novaRockDraftRevision, parseNovaRockReviewDraft, validateNovaRockReviewDraft } from "../lib/ingestion/novarock-review-draft.ts";

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
test("real PostgreSQL: non-authorizing 44-identity draft, invalid/stale/replay/concurrency, zero catalogue writes", { timeout: 60000 }, async (t) => {
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
    assert.equal(await db.user.count({ where: { OR: [{ id: fixture.draft.proposedReviewerUserId }, { email: "synthetic-admin@example.invalid" }] } }), 0, "synthetic user fixture must not exist");
    await db.festival.create({ data: fixture.festival });
    await db.festivalEdition.create({ data: fixture.edition });
    for (const { identities: _identities, links: _links, provenance: _provenance, ...a } of fixture.artists) await db.artist.create({ data: a });
    await db.lineupEntry.createMany({ data: fixture.lineup });
    await db.user.create({ data: { id: fixture.draft.proposedReviewerUserId, email: "synthetic-admin@example.invalid", role: "ADMIN" } });
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
    const festival = await db.festival.findUniqueOrThrow({ where: { id: fixture.festival.id } });
    const edition = await db.festivalEdition.findUniqueOrThrow({ where: { id: fixture.edition.id } });
    const lineup = await db.lineupEntry.findMany({ where: { editionId: edition.id } });
    const artists = await db.artist.findMany({ include: { identities: { orderBy: { id: "asc" } }, links: { orderBy: { id: "asc" } }, provenance: { orderBy: { id: "asc" } } } });
    const draft = parseNovaRockReviewDraft({ ...fixture.draft, sealId: seal.id, candidateId: candidate.id, contentDigest: seal.contentDigest,
      baseline: novaRockDraftBaseline(festival, edition, lineup, artists.filter((a) => lineup.some((e) => e.artistId === a.id))),
      cards: fixture.draft.cards.map((c) => ({ ...c, artistRevision: novaRockDraftRevision(json(artists.find((a) => a.id === c.artistId))) })) });
    async function catalogue() {
      return json({ festival: await db.festival.findMany({ orderBy: { id: "asc" } }), edition: await db.festivalEdition.findMany({ orderBy: { id: "asc" } }), lineup: await db.lineupEntry.findMany({ orderBy: { id: "asc" } }),
        artists: await db.artist.findMany({ orderBy: { id: "asc" } }), publications: await db.catalogPublication.count(), queues: await db.catalogPlaylistRefresh.count(),
        playlists: await db.festivalPlaylist.count(), festivalCount: await db.festival.count(), editionCount: await db.festivalEdition.count(),
        artistCount: await db.artist.count(), lineupCount: await db.lineupEntry.count() });
    }
    const before = await catalogue();
    const valid = await validateNovaRockReviewDraft(db, draft);
    assert.equal(valid.authority, "NONE");
    assert.deepEqual(valid.blockers, ["NO_INDEPENDENT_CARD_EVIDENCE", "CALLER_NOT_AUTHENTICATED_BY_DRAFT_VALIDATOR"]);
    await t.test("replay and simultaneous validations are read-only", async () => {
      assert.deepEqual(await validateNovaRockReviewDraft(db, draft), valid);
      const outcomes = await Promise.allSettled([validateNovaRockReviewDraft(db, draft), validateNovaRockReviewDraft(db, draft)]);
      assert.ok(outcomes.some((o) => o.status === "fulfilled"));
      for (const o of outcomes) {
        if (o.status === "fulfilled") assert.deepEqual(o.value, valid);
        else assert.ok(o.reason instanceof Prisma.PrismaClientKnownRequestError && (o.reason.code === "P2034" || (o.reason.code === "P2010" && o.reason.meta?.code === "40001")));
      }
      assert.deepEqual(await catalogue(), before);
    });
    const invalid: [string, (d: typeof draft) => void, RegExp][] = [
      ["expired draft", (d) => d.expiresAt = "2020-01-01T00:00:00Z", /Expired/],
      ["unbounded expiry", (d) => d.expiresAt = "2099-01-01T00:00:00Z", /unbounded/],
      ["unknown reviewer", (d) => d.proposedReviewerUserId = "unknown", /DB ADMIN/],
      ["wrong digest", (d) => d.contentDigest = "f".repeat(64), /Substituted/],
      ["unknown artist", (d) => d.cards[43].artistId = "unknown", /Unknown/],
      ["reused artist", (d) => d.cards[43].artistId = d.cards[42].artistId, /Reused/],
      ["stale artist revision", (d) => d.cards[43].artistRevision = "f".repeat(64), /stale artist/],
      ["later card disagreement", (d) => { d.cards[43].caption = "Other"; d.cards[43].canonicalName = "Other"; }, /sealed ordered/],
      ["unverified extra evidence", (d) => (d.cards[43] as any).independentlyVerified = true, /Unrecognized/],
    ];
    for (const [label, mutate, error] of invalid) await t.test(label, async () => {
      const changed = structuredClone(draft); mutate(changed);
      await assert.rejects(validateNovaRockReviewDraft(db, changed), error);
      assert.deepEqual(await catalogue(), before);
    });
    await t.test("role revoked and editor excluded", async () => {
      await db.user.update({ where: { id: draft.proposedReviewerUserId }, data: { role: "EDITOR" } });
      await assert.rejects(validateNovaRockReviewDraft(db, draft), /DB ADMIN/);
      await db.user.update({ where: { id: draft.proposedReviewerUserId }, data: { role: "ADMIN" } });
    });
    await t.test("source generation swap and reclaimed lease rejected", async () => {
      const rollback = new Error("Rollback synthetic source mutation");
      async function rolledBackCase(mutate: (tx: Prisma.TransactionClient) => Promise<void>) {
        await assert.rejects(db.$transaction(async (tx) => {
          const [isolation] = await tx.$queryRawUnsafe<{ transaction_isolation: string }[]>("SHOW transaction_isolation");
          assert.equal(isolation.transaction_isolation, "serializable");
          await mutate(tx);
          // Reuse this real transaction so the validator observes the mutation.
          // Rollback preserves the original generation; never reset/bypass the trigger.
          const inTransaction = { $transaction: async (fn: (inner: Prisma.TransactionClient) => Promise<unknown>, options: any) => {
            assert.equal(options.isolationLevel, "Serializable"); return fn(tx);
          } } as unknown as PrismaClient;
          await assert.rejects(validateNovaRockReviewDraft(inTransaction, draft), /Stale/);
          throw rollback;
        }, { isolationLevel: "Serializable", timeout: 10000 }), (error) => error === rollback);
        assert.deepEqual(await db.festivalSource.findUniqueOrThrow({ where: { id: source.id }, include: { edition: true } }), source);
        assert.deepEqual(await validateNovaRockReviewDraft(db, draft), valid);
      }
      for (const data of [{ cadenceSeconds: source.cadenceSeconds! + 1 }, { leaseVersion: source.leaseVersion + 1 }, { enabled: false },
        { url: "https://www.novarock.at/" }, { leaseOwner: provenance.leaseOwner, leaseExpiresAt: new Date(Date.now() + 10000) }]) {
        await rolledBackCase(async (tx) => {
          const changed = await tx.festivalSource.update({ where: { id: source.id }, data });
          assert.equal(changed.configurationGeneration, source.configurationGeneration +
            ("cadenceSeconds" in data || "enabled" in data || "url" in data ? 1 : 0));
        });
      }
      await rolledBackCase(async (tx) => {
        const away = await tx.festivalSource.update({ where: { id: source.id }, data: { url: "https://www.novarock.at/" } });
        const back = await tx.festivalSource.update({ where: { id: source.id }, data: { url: source.url } });
        assert.equal(away.configurationGeneration, source.configurationGeneration + 1);
        assert.equal(back.configurationGeneration, source.configurationGeneration + 2);
        assert.equal(back.url, source.url);
      });
    });
    await t.test("competing source rejected", async () => {
      const stamp = new Date();
      const extra = await db.festivalSource.create({ data: {
        id: "synthetic-competing-nova-source", festivalId: festival.id, festivalSlug: "nova-rock", editionYear: 2027, editionId: edition.id,
        url: "https://www.novarock.at/", strategies: ["official_markup"], refreshPolicy: "daily", enabled: true,
        parserKey: "official_markup:nova-rock", cadenceSeconds: 86400, configurationBackfilledAt: source.configurationBackfilledAt,
        configurationGeneration: 1, leaseVersion: 0, createdAt: stamp, updatedAt: stamp,
      } });
      try { await assert.rejects(validateNovaRockReviewDraft(db, draft), /Competing/); }
      finally { await db.festivalSource.delete({ where: { id: extra.id } }); }
    });
    await t.test("mutable edition, billing and artist alias baseline rejected", async () => {
      await db.festivalEdition.update({ where: { id: edition.id }, data: { startDate: new Date("2027-06-11") } });
      await assert.rejects(validateNovaRockReviewDraft(db, draft), /baseline/);
      await db.festivalEdition.update({ where: { id: edition.id }, data: { startDate: edition.startDate, updatedAt: edition.updatedAt } });
      await db.lineupEntry.update({ where: { id: lineup[0].id }, data: { position: 8 } });
      await assert.rejects(validateNovaRockReviewDraft(db, draft), /baseline/);
      await db.lineupEntry.update({ where: { id: lineup[0].id }, data: { position: lineup[0].position } });
      const baselineArtist = artists.find((a) => a.id === lineup[0].artistId)!;
      await db.artist.update({ where: { id: baselineArtist.id }, data: { aliases: ["Changed alias"] } });
      await assert.rejects(validateNovaRockReviewDraft(db, draft), /baseline/);
      await db.artist.update({ where: { id: baselineArtist.id }, data: { aliases: baselineArtist.aliases, updatedAt: baselineArtist.updatedAt } });
    });
    await t.test("independent alias collision across catalogue rejected", async () => {
      const { identities: _i, links: _l, provenance: _p, ...a } = fixture.artists[43];
      await db.artist.create({ data: { ...a, id: "synthetic-ambiguous", slug: "synthetic-ambiguous", name: "Other identity", aliases: [draft.cards[43].caption] } });
      await assert.rejects(validateNovaRockReviewDraft(db, draft), /ambiguous/);
      await db.artist.delete({ where: { id: "synthetic-ambiguous" } });
    });
    // Instrument actual transactions only; never substitute PostgreSQL rows or locks.
    // Edition race is reversible. The final source race advances generation for
    // good: restoring the actual config must leave the old sealed draft stale.
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
        validation = validateNovaRockReviewDraft(instrumented, draft);
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
        await assert.rejects(validateNovaRockReviewDraft(db, draft), /Stale/, "fresh retry cannot adopt a newer configuration generation");
      } else assert.deepEqual(await validateNovaRockReviewDraft(db, draft), valid, "fresh read retry only");
    });
    assert.deepEqual(await catalogue(), before);
    await t.test("newer failed attempt invalidates the sealed draft", async () => {
      const later = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-unattested", totalSources: 1 });
      await persistAttempt(db, { ...input, runId: later.id, endedAt: new Date("2026-10-08T00:00:02Z"), error: "synthetic newer failure" });
      await assert.rejects(validateNovaRockReviewDraft(db, draft), /Historical/);
    });
    assert.deepEqual(await catalogue(), before);
    assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).reviewState, "PENDING");
    assert.equal((await db.ingestionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, "REVIEW");
    assert.equal(await db.novaRockContentSeal.count(), 1);
  } finally { await db.$disconnect(); }
});
