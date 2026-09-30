import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { backfillCatalog } from "../lib/catalog/backfill.ts";
import { catalogSeed } from "../lib/catalog/seed.ts";
import { festivalSources } from "../data/festival-sources.ts";
import { audit, migrationApplied, runSourceBackfill } from "../scripts/deploy/run-source-backfill.ts";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("A disposable test/integration DATABASE_URL is required");
const db = new PrismaClient();
const nonce = "b".repeat(64);
test.before(async () => {
  await db.festivalSource.deleteMany();
  await db.festival.deleteMany();
  await db.artist.deleteMany();
  await backfillCatalog(db, catalogSeed);
});
test.after(async () => {
  await db.festivalSource.deleteMany();
  await db.festival.deleteMany();
  await db.artist.deleteMany();
  await db.$disconnect();
});

test("missing migration fails before any writes", async () => {
  assert.equal(await migrationApplied(db), true);
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = \'20260930190000_source_configuration_foundation\'');
    const gated = await runSourceBackfill(tx as unknown as PrismaClient, "apply", nonce);
    assert.equal(gated.ok, false);
    assert.match(gated.output, /migration-missing/);
    throw new Error("rollback test migration state");
  }), /rollback test migration state/);
  assert.equal(await migrationApplied(db), true);
  assert.equal(await db.festivalSource.count({ where: { configurationBackfilledAt: { not: null } } }), 0);
});

test("preview stays read-only, apply idempotent, verify checks completeness", async () => {
  const before = await db.festivalSource.findMany({ orderBy: [{ festivalSlug: "asc" }, { url: "asc" }] });
  const preview = await runSourceBackfill(db, "preview", nonce);
  assert.equal(preview.ok, true);
  assert.equal(JSON.parse(preview.output).nonce, nonce);
  assert.match(preview.output, /"mode":"preview"/);
  assert.equal(JSON.parse(preview.output).counts.fill, festivalSources.length);
  assert.deepEqual(await db.festivalSource.findMany({ orderBy: [{ festivalSlug: "asc" }, { url: "asc" }] }), before);
  const pending = await runSourceBackfill(db, "verify", nonce);
  assert.equal(pending.ok, false);
  const applied = await runSourceBackfill(db, "apply", nonce);
  assert.equal(applied.ok, true);
  const after = await db.festivalSource.findMany({ orderBy: [{ festivalSlug: "asc" }, { url: "asc" }] });
  assert.equal(after.filter((row) => row.configurationBackfilledAt).length, festivalSources.length);
  assert.deepEqual(JSON.parse((await runSourceBackfill(db, "apply", nonce)).output).counts, { insert: 0, fill: 0, preserve: festivalSources.length });
  assert.deepEqual(await db.festivalSource.findMany({ orderBy: [{ festivalSlug: "asc" }, { url: "asc" }] }), after);
  assert.equal((await runSourceBackfill(db, "verify", nonce)).ok, true);
});

test("marked-row drift fails closed without repairing or writing unrelated rows", async () => {
  const row = await db.festivalSource.findFirstOrThrow({ where: { festivalSlug: festivalSources[0].festivalSlug } });
  await db.festivalSource.update({ where: { id: row.id }, data: { enabled: !row.enabled } });
  const pending = await db.festivalSource.findFirstOrThrow({ where: { festivalSlug: festivalSources[1].festivalSlug } });
  await db.festivalSource.delete({ where: { id: pending.id } });
  const edited = await db.festivalSource.findUniqueOrThrow({ where: { id: row.id } });
  const preview = await runSourceBackfill(db, "preview", nonce);
  assert.equal(preview.ok, false);
  assert.equal(JSON.parse(preview.output).drift, 1);
  assert.doesNotMatch(preview.output, /https?:\/\//);
  await assert.rejects(runSourceBackfill(db, "apply", nonce), /Unresolved source drift/);
  assert.deepEqual(await db.festivalSource.findUniqueOrThrow({ where: { id: row.id } }), edited);
  assert.equal(await db.festivalSource.findUnique({ where: { id: pending.id } }), null);
  assert.doesNotMatch(audit("apply", "guard-or-data-error", nonce), /https?:\/\//);
  await db.festivalSource.update({ where: { id: row.id }, data: { enabled: row.enabled } });
});

test("missing or malformed nonce fails before database access", async () => {
  for (const invalid of ["", "A".repeat(64), "f".repeat(63), "x".repeat(64)]) {
    const forbidden = { $queryRaw: () => { throw new Error("database accessed"); } } as unknown as PrismaClient;
    await assert.rejects(runSourceBackfill(forbidden, "apply", invalid), /invalid source operation nonce/);
  }
});
