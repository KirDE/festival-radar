import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { backfillSources, listConfiguredSources } from "../lib/sources/repository.ts";
import type { FestivalSource } from "../lib/ingestion/types.ts";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("A disposable test/integration DATABASE_URL is required");
const db = new PrismaClient();
const slug = "source-fixture-" + Math.random().toString(36).slice(2);
const one: FestivalSource = { festivalSlug: slug, url: "https://example.test/first", strategies: ["json_ld_event", "html_fallback"], refreshPolicy: "daily", enabled: true, editionYear: 2027 };
const two: FestivalSource = { ...one, url: "https://example.test/second", enabled: false, strategies: ["manual_review"], manualReviewReason: "synthetic manual-only source", refreshPolicy: "archived" };
const key = (item: FestivalSource) => ({ festivalSlug_url: { festivalSlug: item.festivalSlug, url: item.url } });

test.before(async () => {
  await db.festival.create({ data: { slug, name: "Fixture", country: "Test", countryCode: "DE", officialUrl: one.url, genres: [], editions: { create: { year: 2027, status: "TBA", ticketStatus: "UNKNOWN", recordState: "TRACKING", completeness: "TBA", sourceUpdatedAt: new Date() } } } });
  // Legacy row from prior catalogue backfill; source config remains absent.
  await db.festivalSource.create({ data: { festivalSlug: slug, festival: { connect: { slug } }, url: one.url, strategies: one.strategies, refreshPolicy: one.refreshPolicy, enabled: one.enabled, editionYear: one.editionYear } });
});
test.after(async () => {
  await db.festivalSource.deleteMany({ where: { festivalSlug: slug } });
  await db.festival.delete({ where: { slug } });
  await db.$disconnect();
});

test("preview is read-only, fill legacy and insert additional URL, rerun preserves edits", async () => {
  const inventory = [one, two];
  await db.festivalSource.update({ where: key(one), data: { refreshPolicy: "weekly" } });
  await assert.rejects(backfillSources(db, inventory), /Legacy source configuration conflict/);
  assert.equal(await db.festivalSource.count({ where: { festivalSlug: slug } }), 1);
  await db.festivalSource.update({ where: key(one), data: { refreshPolicy: "daily" } });
  const preview = await backfillSources(db, inventory, { dryRun: true });
  assert.deepEqual(preview.counts, { insert: 1, fill: 1, preserve: 0 });
  assert.equal((await db.festivalSource.findUniqueOrThrow({ where: key(one) })).parserKey, null);
  const applied = await backfillSources(db, inventory);
  assert.equal(applied.ok, true);
  const rows = await listConfiguredSources(db, slug);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.url === one.url)?.parserKey, "json_ld_event+html_fallback");
  assert.equal(rows.find((row) => row.url === two.url)?.enabled, false);
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festival: { slug } } });
  assert.ok(rows.every((row) => row.editionId === edition.id));
  await db.festivalSource.update({ where: key(one), data: { fetchUrl: "https://example.test/operator", enabled: false, parserKey: "manual_review", strategies: ["manual_review"], nextRunAt: new Date("2027-01-01"), httpEtag: "operator", leaseOwner: "operator", consecutiveFailures: 2 } });
  const repeated = await backfillSources(db, inventory);
  assert.equal(repeated.counts.preserve, 2);
  assert.equal(repeated.ok, false); // drift is reported, never repaired
  const edited = await db.festivalSource.findUniqueOrThrow({ where: key(one) });
  assert.equal(edited.fetchUrl, "https://example.test/operator");
  assert.equal(edited.enabled, false);
  assert.equal(edited.httpEtag, "operator");
  assert.equal(edited.leaseOwner, "operator");
  assert.equal(edited.consecutiveFailures, 2);
  await db.festivalSource.update({ where: key(one), data: { fetchUrl: null } });
  await backfillSources(db, inventory);
  assert.equal((await db.festivalSource.findUniqueOrThrow({ where: key(one) })).fetchUrl, null);
  assert.equal(edited.nextRunAt?.toISOString(), "2027-01-01T00:00:00.000Z");
});

test("invalid edition and parser abort atomically", async () => {
  await assert.rejects(backfillSources(db, [{ ...one, url: "https://example.test/third" }, { ...one, url: "https://example.test/bad", editionYear: 2028 }]), /Missing source edition/);
  assert.equal(await db.festivalSource.count({ where: { festivalSlug: slug } }), 2);
  await assert.rejects(backfillSources(db, [{ ...one, strategies: ["unknown" as never] }]), /Invalid parser strategies/);
});
