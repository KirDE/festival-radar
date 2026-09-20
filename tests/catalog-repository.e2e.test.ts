import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { artistProfiles } from "../data/artists.ts";
import { festivalEditions } from "../data/editions.ts";
import { festivals } from "../data/festivals.ts";
import playlistStatus from "../data/playlist-status.json" with { type: "json" };
import { backfillCatalog } from "../lib/catalog/backfill.ts";
import { DatabaseCatalogRepository, readCatalog } from "../lib/catalog/repository.ts";
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
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.festivals)), JSON.parse(JSON.stringify(festivals)));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.artists)), JSON.parse(JSON.stringify(artistProfiles)));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.playlists)), JSON.parse(JSON.stringify(playlistStatus)));
  assert.equal(snapshot.editions.length, festivalEditions.length);
  assert.equal(snapshot.editions.find(({ slug, editionYear }) => slug === "wacken-open-air" && editionYear === 2026)?.recordState, "archived");
});

test("database reads fail closed without a file fallback", async () => {
  const failure = new Error("catalogue database unavailable");
  const failingDatabase = {
    festivalEdition: { findMany: async () => { throw failure; } },
    artist: { findMany: async () => [] },
  } as unknown as PrismaClient;
  await assert.rejects(
    readCatalog({ database: failingDatabase }),
    /catalogue database unavailable/,
  );
});

test("database reads do not retain a process-lifetime catalogue snapshot", async () => {
  const before = await readCatalog({ database: db });
  const originalName = before.festivals[0].name;
  const changedName = `${originalName} fresh-read-check`;
  await db.festival.update({ where: { slug: before.festivals[0].slug }, data: { name: changedName } });
  try {
    const after = await readCatalog({ database: db });
    assert.equal(after.festivals[0].name, changedName);
  } finally {
    await db.festival.update({ where: { slug: before.festivals[0].slug }, data: { name: originalName } });
  }
});
