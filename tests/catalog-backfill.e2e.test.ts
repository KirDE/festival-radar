import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { backfillCatalog, verifyCatalogParity } from "../lib/catalog/backfill.ts";
import { catalogSeed } from "../lib/catalog/seed.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) {
  throw new Error("A test or integration DATABASE_URL is required");
}

const db = new PrismaClient();

async function clearCatalog() {
  await db.festivalSource.deleteMany();
  await db.festival.deleteMany();
  await db.artist.deleteMany();
}

test.before(clearCatalog);
test.after(async () => { await clearCatalog(); await db.$disconnect(); });

test("catalog backfill is complete and idempotent", async () => {
  const first = await backfillCatalog(db, catalogSeed);
  assert.equal(first.ok, true, first.mismatches.join("\n"));
  const second = await backfillCatalog(db, catalogSeed);
  assert.deepEqual(second, first);
});

test("parity verification detects missing relational data", async () => {
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { lineup: { some: {} } } });
  await db.lineupEntry.deleteMany({ where: { editionId: edition.id } });
  const report = await verifyCatalogParity(db, catalogSeed);
  assert.equal(report.ok, false);
  assert.match(report.mismatches.join("\n"), /lineupEntries|lineup differs|headliners differ/);
  const repaired = await backfillCatalog(db, catalogSeed);
  assert.equal(repaired.ok, true, repaired.mismatches.join("\n"));
});

test("parity verification detects field drift", async () => {
  const target = catalogSeed.festivals[0];
  await db.festival.update({ where: { slug: target.slug }, data: { city: "Wrong city" } });
  const report = await verifyCatalogParity(db, catalogSeed);
  assert.equal(report.ok, false);
  assert.match(report.mismatches.join("\n"), new RegExp(`festival ${target.slug}: field mismatch`));
  const repaired = await backfillCatalog(db, catalogSeed);
  assert.equal(repaired.ok, true, repaired.mismatches.join("\n"));
});

test("backfill refuses conflicting existing natural keys", async () => {
  const target = catalogSeed.festivals[0];
  await db.festival.update({ where: { slug: target.slug }, data: { name: "Conflicting festival" } });
  await assert.rejects(() => backfillCatalog(db, catalogSeed), /Festival conflict/);
  await db.festival.update({ where: { slug: target.slug }, data: { name: target.name } });
});
