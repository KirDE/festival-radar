import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { ACTIVATION, artistSlug, PLAN, PLAN_HASH, PUBLICATION_KEY } from "../lib/operations/rockharz-2027-plan.ts";
import { ARTIST_READ_LIMIT, guardedRockharzUpdate, resolveArtistIdentities } from "../lib/operations/rockharz-2027-update.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
// Migrations and fixtures go into a brand-new schema, never the caller's tables.
const schema = `rockharz_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("schema", schema);
const db = new PrismaClient({ datasourceUrl: url.toString() });
const control = new PrismaClient();
const now = new Date("2026-10-08T12:00:00Z");
const input = { operation: "activate" as const, expectedCommit: "a".repeat(40), planHash: PLAN_HASH, runId: "123:1", activation: ACTIVATION };
test.before(async () => {
  // pgcrypto can already be installed in public by the parent test database.
  // Prisma narrows search_path to this fresh schema, so expose only digest here.
  await control.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await control.$executeRawUnsafe(`CREATE FUNCTION "${schema}".digest(bytea, text) RETURNS bytea LANGUAGE SQL IMMUTABLE STRICT AS 'SELECT public.digest($1, $2)'`);
  await promisify(execFile)(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 60000,
  });
});
test.after(async () => {
  await db.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
});
async function fixture() {
  await db.$executeRawUnsafe('TRUNCATE "Festival", "Artist", "CatalogPublication", "AdminAuditEntry", "IngestionRun", "User", "AdminDraft", "AdminChange" CASCADE');
  const festival = await db.festival.create({ data: { slug: PLAN.slug, name: PLAN.name, country: "Germany", countryCode: "DE",
    officialUrl: "https://www.rockharz-festival.com/", genres: [], editions: { create: {
      year: 2027, startDate: new Date("2027-07-07"), endDate: new Date("2027-07-10"),
      status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: now,
    } } }, include: { editions: true } });
  // Synthetic, already-reviewed identities for retained article/tile differences.
  for (const difference of PLAN.tileSpellingDifferences) {
    const row = await artist(difference.articleName);
    await db.artist.update({ where: { id: row.id }, data: { aliases: [difference.tileTitle] } });
  }
  return festival;
}
async function artist(name: string, slug = artistSlug(name)) {
  return db.artist.create({ data: { name, slug, aliases: [], genres: [], topTracks: [], recentSetlists: [], freshness: {}, identityState: "UNRESOLVED" } });
}
test("atomic existing-record update, reuse, independent readback, no queues, replay rejected", async () => {
  const festival = await fixture();
  const existing = await artist("ACCEPT", "accept-existing-identity");
  const inspect = await guardedRockharzUpdate(db, { ...input, operation: "inspect" }, now);
  assert.equal(inspect.status, "READY");
  assert.equal(await db.artist.count(), 4);
  const applied = await guardedRockharzUpdate(db, input, now);
  assert.equal(applied.status, "VERIFIED");
  assert.equal(applied.editionId, festival.editions[0].id);
  assert.equal(await db.festival.count(), 1);
  assert.equal(await db.festivalEdition.count(), 1);
  assert.equal(await db.artist.count(), 27);
  assert.equal(await db.lineupEntry.count({ where: { artistId: existing.id } }), 1);
  assert.equal(await db.catalogPlaylistRefresh.count(), 0);
  assert.equal(await db.ingestionNotificationOutbox.count(), 0);
  assert.equal(await db.festivalPlaylist.count(), 0);
  assert.deepEqual(await guardedRockharzUpdate(db, { ...input, operation: "readback" }, now), applied);
  await assert.rejects(guardedRockharzUpdate(db, input, now));
  assert.equal(await db.catalogPublication.count({ where: { sourceId: PUBLICATION_KEY } }), 1);
  assert.equal(await db.adminAuditEntry.count(), 1);
  await db.lineupEntry.updateMany({ where: { editionId: applied.editionId, billing: "HEADLINER" }, data: { status: "CANCELLED" } });
  await assert.rejects(guardedRockharzUpdate(db, { ...input, operation: "readback" }, now), /readback/);
});

const conflicts: [string, (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>][] = [
  ["wrong name", (f) => db.festival.update({ where: { id: f.id }, data: { name: "Rockharz" } })],
  ["missing festival", () => db.festival.deleteMany()],
  ["duplicate festival name", () => db.festival.create({ data: { slug: "another-rockharz", name: PLAN.name, country: "Germany", countryCode: "DE", officialUrl: "https://www.rockharz-festival.com/", genres: [] } })],
  ["wrong city", (f) => db.festival.update({ where: { id: f.id }, data: { city: "Other city" } })],
  ["case-changed slug", (f) => db.festival.update({ where: { id: f.id }, data: { slug: "Rockharz" } })],
  ["missing edition", (f) => db.festivalEdition.delete({ where: { id: f.editions[0].id } })],
  ["wrong dates", (f) => db.festivalEdition.update({ where: { id: f.editions[0].id }, data: { endDate: new Date("2027-07-11") } })],
  ["tracking edition", (f) => db.festivalEdition.update({ where: { id: f.editions[0].id }, data: { recordState: "TRACKING" } })],
  ["wrong status", (f) => db.festivalEdition.update({ where: { id: f.editions[0].id }, data: { status: "PARTIAL" } })],
  ["wrong completeness", (f) => db.festivalEdition.update({ where: { id: f.editions[0].id }, data: { completeness: "PARTIAL" } })],
  ["wrong tickets", (f) => db.festivalEdition.update({ where: { id: f.editions[0].id }, data: { ticketStatus: "AVAILABLE" } })],
  ["wrong ticket URL", (f) => db.festivalEdition.update({ where: { id: f.editions[0].id }, data: { ticketsUrl: "https://conflict.example/" } })],
  ["second CURRENT", (f) => db.festivalEdition.create({ data: { festivalId: f.id, year: 2026, status: "TBA", completeness: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT", sourceUpdatedAt: now } })],
  ["existing cancelled lineup", async (f) => db.lineupEntry.create({ data: { editionId: f.editions[0].id, artistId: (await artist("Accept")).id, billing: "LINEUP", position: 0, status: "CANCELLED" } })],
  ["source with malformed binding", (f) => db.festivalSource.create({ data: { festivalSlug: PLAN.slug, url: "https://conflict.example/", editionId: f.editions[0].id, editionYear: 2026, enabled: false, refreshPolicy: "daily", strategies: ["html_fallback"] } })],
  ["provenance", (f) => db.editionProvenance.create({ data: { editionId: f.editions[0].id, field: "lineup", url: "https://conflict.example/", note: "conflict", checkedAt: now } })],
  ["unbound 2027 source", () => db.festivalSource.create({ data: { festivalSlug: PLAN.slug, url: "https://conflict.example/", editionYear: 2027, enabled: false, refreshPolicy: "weekly", strategies: ["manual_review"] } })],
  ["timetable", (f) => db.timetablePerformance.create({ data: { editionId: f.editions[0].id, artistName: "Artist", date: new Date("2027-07-07"), stage: "Stage", start: "18:00" } })],
  ["existing playlist", (f) => db.festivalPlaylist.create({ data: { editionId: f.editions[0].id, provider: "spotify", url: "https://conflict.example/" } })],
  ["existing publication", () => db.catalogPublication.create({ data: { source: "ADMIN", sourceId: "other", festivalSlug: PLAN.slug, editionYear: 2027, actorLabel: "test", fields: [] } })],
  ["playlist queue", async () => { const p = await db.catalogPublication.create({ data: { source: "ADMIN", sourceId: "prior-year", festivalSlug: PLAN.slug, editionYear: 2026, actorLabel: "test", fields: [] } }); await db.catalogPlaylistRefresh.create({ data: { publicationId: p.id, festivalSlug: PLAN.slug } }); }],
  ["pending admin draft", async () => { const user = await db.user.create({ data: { email: "test@example.test" } }); await db.adminDraft.create({ data: { resourceKind: "FESTIVAL", resourceKey: PLAN.slug, baseRevision: 0, values: {}, createdById: user.id } }); }],
  ["pending admin change", () => db.adminChange.create({ data: { resourceKind: "FESTIVAL", resourceKey: PLAN.slug, field: "lineup", baseRevision: 0, beforeValue: [], afterValue: ["conflict"], sourceEvidence: {} } })],
  ["duplicate case-insensitive artist names", async () => { await artist("Accept"); await artist("ACCEPT", "accept-other"); }],
  ["artist slug collision", () => artist("Other Artist", "accept")],
  ["artist alias collision", async () => { const a = await artist("Other Artist"); await db.artist.update({ where: { id: a.id }, data: { aliases: ["ACCEPT"] } }); }],
  ["folded diacritic name", () => artist("Áccept", "accented-accept")],
  ["folded punctuation name", () => artist("StormSeeker", "stormseeker")],
  ["folded stroked-letter name without exact match", async () => { await db.artist.deleteMany({ where: { name: "SETYØURSAILS" } }); await artist("SETYOURSAILS", "setyoursails"); }],
  ["folded duplicate canonical and tile names", () => artist("SETYOURSAILS", "setyoursails")],
  ["folded mixed-case alias", async () => { const a = await artist("Other Artist"); await db.artist.update({ where: { id: a.id }, data: { aliases: ["sEtYoUrSaIlS"] } }); }],
  ["folded combining-mark alias", async () => { const a = await artist("Other Artist"); await db.artist.update({ where: { id: a.id }, data: { aliases: ["A\u0301cCePt"] } }); }],
  ["folded punctuation alias beside exact identity", async () => { const a = await artist("Other Artist"); await db.artist.update({ where: { id: a.id }, data: { aliases: ["STORM-SEEKER"] } }); }],
  ["verified tile plural spelling", () => artist("IGELS VS. SHARK", "igels-vs-shark")],
  ["unresolved article/tile identity", () => db.artist.deleteMany({ where: { name: "Igel vs. Shark" } })],
  ["ambiguous identity", async () => { const a = await artist("Accept"); await db.artist.update({ where: { id: a.id }, data: { identityState: "AMBIGUOUS" } }); }],
];
for (const [name, conflict] of conflicts) test(`abort without partial writes: ${name}`, async () => {
  const f = await fixture();
  await conflict(f);
  const snapshot = async () => ({ artists: await db.artist.count(), lineup: await db.lineupEntry.count(), sources: await db.festivalSource.count(), proofs: await db.editionProvenance.count(), publications: await db.catalogPublication.count(), jobs: await db.catalogPlaylistRefresh.count() });
  const before = await snapshot();
  await assert.rejects(guardedRockharzUpdate(db, input, now));
  assert.deepEqual(await snapshot(), before);
  assert.equal(await db.adminAuditEntry.count(), 0);
});
test("exact case-insensitive identity with its own folded aliases is reused", async () => {
  await fixture();
  const existing = await db.artist.findFirstOrThrow({ where: { name: "SETYØURSAILS" } });
  await db.artist.update({ where: { id: existing.id }, data: { slug: "existing-provider-slug", aliases: ["SETYOURSAILS", "Set Yøur Sails"] } });
  const applied = await guardedRockharzUpdate(db, input, now);
  assert.equal(await db.artist.count(), 27);
  assert.equal(await db.lineupEntry.count({ where: { editionId: applied.editionId, artistId: existing.id } }), 1);
  assert.equal((await db.artist.findUniqueOrThrow({ where: { id: existing.id } })).slug, "existing-provider-slug");
});
test("DB-backed apostrophe and diacritic variants require identity review", async () => {
  await fixture();
  const existing = await artist("D'Artagnan", "dartagnan-existing");
  const other = await artist("Other Artist");
  await db.artist.update({ where: { id: other.id }, data: { aliases: ["D’ÀRTAGNAN"] } });
  const rows = await db.artist.findMany({ take: ARTIST_READ_LIMIT + 1,
    select: { id: true, name: true, slug: true, aliases: true, identityState: true } });
  assert.throws(() => resolveArtistIdentities(rows, [existing.name]), /ambiguity/);
  assert.throws(() => resolveArtistIdentities(rows.filter((r) => r.id === existing.id), ["D’Artagnan"]), /requires review/);
  assert.equal(await db.catalogPublication.count(), 0);
});
test("preserves archived editions, sources and provenance", async () => {
  const f = await fixture();
  const archived = await db.festivalEdition.create({ data: { festivalId: f.id, year: 2026,
    status: "CONFIRMED", completeness: "COMPLETE", ticketStatus: "UNAVAILABLE", recordState: "ARCHIVED", sourceUpdatedAt: now } });
  const source = await db.festivalSource.create({ data: { festivalId: f.id, festivalSlug: PLAN.slug,
    editionId: archived.id, editionYear: 2026, url: "https://prior-year.example/", enabled: false, strategies: ["manual_review"], refreshPolicy: "archived" } });
  const proof = await db.editionProvenance.create({ data: { editionId: archived.id, field: "lineup", url: source.url, note: "archived evidence", checkedAt: now } });
  await guardedRockharzUpdate(db, input, now);
  assert.deepEqual(await db.festivalEdition.findUnique({ where: { id: archived.id } }), archived);
  assert.deepEqual(await db.festivalSource.findUnique({ where: { id: source.id } }), source);
  assert.deepEqual(await db.editionProvenance.findUnique({ where: { id: proof.id } }), proof);
});
test("concurrent activations have one winner", async () => {
  await fixture();
  const results = await Promise.allSettled([guardedRockharzUpdate(db, input, now), guardedRockharzUpdate(db, input, now)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await db.lineupEntry.count(), 27);
  assert.equal(await db.catalogPublication.count(), 1);
  assert.equal(await db.adminAuditEntry.count(), 1);
  assert.equal(await db.catalogPlaylistRefresh.count(), 0);
});
test("late audit failure rolls back artists, lineup, fields, sources and publication", async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_rockharz_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_audit BEFORE INSERT ON "AdminAuditEntry" FOR EACH ROW EXECUTE FUNCTION reject_rockharz_audit()`);
  try {
    await assert.rejects(guardedRockharzUpdate(db, input, now));
    assert.equal(await db.artist.count(), PLAN.tileSpellingDifferences.length);
    assert.equal(await db.lineupEntry.count(), 0);
    assert.equal(await db.festivalSource.count(), 0);
    assert.equal(await db.editionProvenance.count(), 0);
    assert.equal(await db.catalogPublication.count(), 0);
    assert.equal(await db.adminAuditEntry.count(), 0);
    assert.equal((await db.festivalEdition.findUniqueOrThrow({ where: { id: f.editions[0].id } })).status, "TBA");
    assert.equal((await db.festival.findUniqueOrThrow({ where: { id: f.id } })).city, null);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER reject_audit ON "AdminAuditEntry"`);
    await db.$executeRawUnsafe(`DROP FUNCTION reject_rockharz_audit()`);
  }
});
