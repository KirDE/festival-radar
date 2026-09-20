import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { backfillCatalog } from "../lib/catalog/backfill.ts";
import { catalogReadMode, DatabaseCatalogRepository, readCatalog } from "../lib/catalog/repository.ts";
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

test.before(async () => {
  await clearCatalog();
  await backfillCatalog(db, catalogSeed);
});
test.after(async () => { await clearCatalog(); await db.$disconnect(); });

test("database repository preserves the public catalogue projection", async () => {
  const snapshot = await new DatabaseCatalogRepository(db).read();
  const files = await readCatalog({ environment: { NODE_ENV: "test" } });
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.festivals)), JSON.parse(JSON.stringify(files.festivals)));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.artists)), JSON.parse(JSON.stringify(files.artists)));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.playlists)), JSON.parse(JSON.stringify(files.playlists)));
  assert.equal(snapshot.editions.length, files.editions.length);
  assert.equal(snapshot.editions.find(({ slug, editionYear }) => slug === "wacken-open-air" && editionYear === 2026)?.recordState, "archived");
});

test("read mode is an explicit kill switch and fallback is opt-in", async () => {
  assert.equal(catalogReadMode({ NODE_ENV: "test" }), "files");
  assert.equal(catalogReadMode({ NODE_ENV: "test", CATALOG_READ_MODE: "database" }), "database");
  assert.throws(() => catalogReadMode({ NODE_ENV: "test", CATALOG_READ_MODE: "automatic" }), /Invalid CATALOG_READ_MODE/);

  const failure = new Error("catalogue database unavailable");
  const failingDatabase = {
    festivalEdition: { findMany: async () => { throw failure; } },
    artist: { findMany: async () => [] },
  } as unknown as PrismaClient;
  await assert.rejects(
    readCatalog({ environment: { NODE_ENV: "test", CATALOG_READ_MODE: "database" }, database: failingDatabase }),
    /catalogue database unavailable/,
  );

  const warning = console.warn;
  console.warn = () => {};
  try {
    const snapshot = await readCatalog({
      environment: { NODE_ENV: "test", CATALOG_READ_MODE: "database", CATALOG_DATABASE_FALLBACK_ENABLED: "true" },
      database: failingDatabase,
    });
    assert.deepEqual(snapshot.festivals.map(({ slug }) => slug), catalogSeed.festivals.map(({ slug }) => slug));
  } finally {
    console.warn = warning;
  }
});

test("database reads do not retain a process-lifetime catalogue snapshot", async () => {
  const before = await readCatalog({ environment: { NODE_ENV: "test", CATALOG_READ_MODE: "database" }, database: db });
  const originalName = before.festivals[0].name;
  const changedName = `${originalName} fresh-read-check`;
  await db.festival.update({ where: { slug: before.festivals[0].slug }, data: { name: changedName } });
  try {
    const after = await readCatalog({ environment: { NODE_ENV: "test", CATALOG_READ_MODE: "database" }, database: db });
    assert.equal(after.festivals[0].name, changedName);
  } finally {
    await db.festival.update({ where: { slug: before.festivals[0].slug }, data: { name: originalName } });
  }
});
