import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, Prisma } from '@prisma/client';
import { claimOperationalState } from '../lib/catalog/operational-state.ts';
import { importTimetable } from '../lib/catalog/timetable-import.ts';
const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error('Disposable test/integration DATABASE_URL required');
const db = new PrismaClient();
const other = new PrismaClient();
const slug = 'synthetic-cutover-test';
test.before(async () => {
  const models = Prisma.dmmf.datamodel.models;
  assert.ok(models.some(model => model.name === 'OperationalState'), 'Generate Prisma client before E2E');
  assert.ok(models.find(model => model.name === 'CatalogPlaylistRefresh')?.fields.some(field => field.name === 'desiredPlan'));
  await db.$queryRaw`SELECT key FROM "OperationalState" LIMIT 0`;
  await db.$queryRaw`SELECT "desiredPlan" FROM "CatalogPlaylistRefresh" LIMIT 0`;
});

test.after(async () => {
  await db.festival.deleteMany({ where: { slug } });
  await db.$executeRaw`DELETE FROM "OperationalState" WHERE key = 'synthetic-cutover-test'`;
  await db.$disconnect(); await other.$disconnect();
});
test('operational checkpoint survives release and only one owner writes', async () => {
  const first = await claimOperationalState(db, slug);
  await assert.rejects(() => claimOperationalState(other, slug), /already running/);
  await first.save({ schemaVersion: 1, progress: 4 });
  await first.release();
  const second = await claimOperationalState(other, slug);
  assert.deepEqual(second.payload, { schemaVersion: 1, progress: 4 });
  await assert.rejects(() => first.save({ progress: 99 }), /lease lost/);
  await second.release();
});
test('reviewed timetable preview, apply and repeat have count/hash parity; unsafe input preserves rows', async () => {
  await db.festival.create({ data: {
    slug, name: 'Synthetic festival', country: 'Test', countryCode: 'DE', genres: [], officialUrl: 'https://example.test/',
    editions: { create: { year: 2027, startDate: new Date('2027-06-01'), endDate: new Date('2027-06-02'), status: 'TBA', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'TBA', sourceUpdatedAt: new Date('2026-01-01') } },
  } });
  const input = { festivalSlug: slug, editionYear: 2027, entries: [{ date: '2027-06-01', stage: 'Synthetic stage', start: '12:00', artist: 'Synthetic artist', timeZone: 'Europe/Berlin', status: 'scheduled' as const, sourceUrl: 'https://example.test/timetable', observedAt: '2026-01-01T00:00:00Z' }] };
  const preview = await importTimetable(db, input);
  assert.equal(preview.changed, 1); assert.equal(preview.beforeCount, 0);
  const applied = await importTimetable(db, input, false);
  assert.equal(applied.afterHash, preview.afterHash);
  const repeat = await importTimetable(db, input, false);
  assert.equal(repeat.changed, 0); assert.equal(repeat.beforeHash, repeat.afterHash);
  await assert.rejects(() => importTimetable(db, { ...input, entries: [] }, false), /removal review/);
  await assert.rejects(() => importTimetable(db, { ...input, entries: [{ ...input.entries[0], date: '2026-06-01' }] }, false));
  assert.equal((await importTimetable(db, input)).changed, 0);
});
