import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { listConfiguredSources } from "../lib/sources/repository.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const slug = "synthetic-source";
test.before(async () => {
  await db.festival.create({ data: { slug, name: "Synthetic Source", country: "Testland", countryCode: "DE", officialUrl: "https://source.example.test/", genres: [], editions: { create: { year: 2027, status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: new Date("2026-01-01") } } } });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug } } });
  await db.festivalSource.create({ data: { festivalSlug: slug, festivalId: edition.festivalId, editionId: edition.id, url: "https://source.example.test/", strategies: ["json_ld_event"], parserKey: "json_ld_event", refreshPolicy: "daily", cadenceSeconds: 86400, editionYear: 2027, configurationBackfilledAt: new Date(), requestHeaders: { "x-fixture": "yes" } } });
});
test.after(async () => { await db.festivalSource.deleteMany({ where: { festivalSlug: slug } }); await db.festival.delete({ where: { slug } }); await db.$disconnect(); });
test("DB source reader preserves operator changes and fails closed on an invalid binding", async () => {
  const first = (await listConfiguredSources(db, slug))[0];
  assert.deepEqual(first.headers, { "x-fixture": "yes" });
  assert.equal(first.parserKey, "json_ld_event");
  await db.festivalSource.update({ where: { id: first.id }, data: { enabled: false, fetchUrl: "https://feed.example.test/", consecutiveFailures: 2 } });
  const edited = (await listConfiguredSources(db, slug))[0];
  assert.equal(edited.enabled, false); assert.equal(edited.fetchUrl, "https://feed.example.test/"); assert.equal(edited.consecutiveFailures, 2);
  await db.festivalSource.update({ where: { id: first.id }, data: { editionYear: 2028 } });
  await assert.rejects(listConfiguredSources(db, slug), /Invalid source edition binding/);
});
