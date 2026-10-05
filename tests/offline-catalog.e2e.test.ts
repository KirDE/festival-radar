import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { catalogSeed } from "../lib/catalog/seed.ts";
import { readOfflineCatalog, serveOfflineCatalog } from "../lib/catalog/offline.ts";

// This test requires an already migrated/backfilled local disposable database.
// It never clears, migrates or seeds the catalogue; mutations always roll back.
const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
if (!target || !["postgres:", "postgresql:"].includes(target.protocol)
  || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)
  || target.searchParams.has("host") || target.searchParams.has("hostaddr")
  || !/^[a-zA-Z0-9_-]*(?:test|integration)[a-zA-Z0-9_-]*$/i.test(target.pathname.slice(1))) {
  throw new Error("Already seeded local disposable test/integration DATABASE_URL required");
}
const db = new PrismaClient();
test.after(async () => { await db.$disconnect(); });
const request = (tag?: string | null) => new Request("http://localhost/api/offline/catalog", {
  headers: tag ? { "If-None-Match": tag } : {},
});

test("existing DB seed has exact legacy JSON and content-derived ETag parity", async () => {
  const festivals = catalogSeed.editions.filter((row) => row.editionYear === 2027 && row.recordState === "current")
    .map((row) => ({
      slug: row.slug, name: row.name, startDate: row.startDate ?? null, endDate: row.endDate ?? null,
      timetable: (row.timetable ?? []).map((entry) => {
        const details = entry as typeof entry & { timeZone?: string; status?: string };
        return {
          date: entry.date, stage: entry.stage, start: entry.start, artist: entry.artist,
          timeZone: details.timeZone ?? "UTC", status: details.status === "cancelled" ? "cancelled" : "scheduled",
        };
      }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0),
    })).sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  assert.ok(festivals.length > 2, "full seed, not the two-festival static sample");
  const expected = JSON.stringify({
    schemaVersion: 1, dataVersion: "festivals-2027-v1", editionYear: 2027, generatedAt: null,
    timetableStatus: festivals.some((row) => row.timetable.length) ? "published" : "not-published", festivals,
  });
  const read = () => readOfflineCatalog(db);
  const response = await serveOfflineCatalog(request(), read);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expected);
  const revision = createHash("sha256").update(expected).digest("hex");
  assert.equal(response.headers.get("etag"), `"${revision}"`);
  assert.equal(response.headers.get("x-catalog-revision"), revision);
  const stable = await serveOfflineCatalog(request(), read);
  assert.equal(await stable.text(), expected);
  assert.equal(stable.headers.get("etag"), response.headers.get("etag"));
  const conditional = await serveOfflineCatalog(request(response.headers.get("etag")), read);
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
});

test("real DB content mutations invalidate ETag; timestamps alone do not; missing rows fail closed", async () => {
  const rollback = new Error("rollback offline test");
  await assert.rejects(db.$transaction(async (tx) => {
    const read = () => readOfflineCatalog(tx);
    const before = await serveOfflineCatalog(request(), read);
    assert.equal(before.status, 200);
    const etag = before.headers.get("etag");
    const edition = await tx.festivalEdition.findFirstOrThrow({ where: { year: 2027, recordState: "CURRENT" } });
    await tx.festivalEdition.update({ where: { id: edition.id }, data: { sourceUpdatedAt: new Date("2035-01-01") } });
    assert.equal((await serveOfflineCatalog(request(etag), read)).status, 304);
    await tx.festival.update({ where: { id: edition.festivalId }, data: { name: "Offline mutation check" } });
    const renamed = await serveOfflineCatalog(request(etag), read);
    assert.equal(renamed.status, 200);
    assert.notEqual(renamed.headers.get("etag"), etag);
    await tx.festivalEdition.update({ where: { id: edition.id }, data: { startDate: new Date("2027-12-30") } });
    const dated = await serveOfflineCatalog(request(renamed.headers.get("etag")), read);
    assert.equal(dated.status, 200);
    await tx.timetablePerformance.create({ data: {
      editionId: edition.id, artistName: "Offline mutation artist", date: new Date("2027-12-30"), stage: "Test", start: "20:00",
    } });
    assert.equal((await serveOfflineCatalog(request(dated.headers.get("etag")), read)).status, 200);
    await tx.festivalEdition.updateMany({ where: { year: 2027, recordState: "CURRENT" }, data: { recordState: "TRACKING" } });
    const missing = await serveOfflineCatalog(request("*"), read);
    assert.equal(missing.status, 503);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.equal(missing.headers.get("etag"), null);
    throw rollback;
  }, { timeout: 15_000 }), (error) => error === rollback);
});
