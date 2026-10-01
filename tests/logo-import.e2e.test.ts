import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { auditReviewedLogos, applyReviewedLogos, previewReviewedLogos, verifyReviewedLogos } from '../lib/catalog/logo-import.ts';
import { requireLocalDisposableLogoDatabase } from './logo-import-db-guard.ts';

requireLocalDisposableLogoDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const rows = await auditReviewedLogos();
const objectName = `logo_import_test_failure_${randomBytes(12).toString('hex')}`;
let functionCreated = false;
let triggerCreated = false;

async function cleanupFailureInjection() {
  if (triggerCreated) {
    await db.$executeRawUnsafe(`DROP TRIGGER "${objectName}" ON "FestivalLogo"`);
    triggerCreated = false;
  }
  if (functionCreated) {
    await db.$executeRawUnsafe(`DROP FUNCTION "${objectName}"()`);
    functionCreated = false;
  }
}

test.after(async () => {
  try { await cleanupFailureInjection(); } finally { await db.$disconnect(); }
});

test('source/DB preflight, transactional rollback, idempotency and exact hash/byte parity', async () => {
  const initial = await previewReviewedLogos(db, rows);
  assert.equal(initial.matchedFestivals, 47);
  assert.equal(initial.existingBindings, 0);
  const beforeBlobs = await db.assetBlob.count();
  await assert.rejects(applyReviewedLogos(db, rows.slice(0, -1)), /Incomplete reviewed inventory/);
  await assert.rejects(applyReviewedLogos(db, rows.map((row, index) => index === 0 ? { ...row, sha256: rows[1].sha256 } : row)), /Per-festival reviewed logo mismatch/);
  await assert.rejects(applyReviewedLogos(db, rows.map((row, index) => index === 46 ? { ...row, bytes: rows[0].bytes } : row)), /content changed/);
  assert.equal(await db.assetBlob.count(), beforeBlobs);
  assert.equal(await db.festivalLogo.count(), 0);
  try {
    await db.$executeRawUnsafe(`CREATE FUNCTION "${objectName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."assetHash" = '${rows[46].sha256}' THEN RAISE EXCEPTION 'injected partial import failure'; END IF; RETURN NEW; END $$`);
    functionCreated = true;
    await db.$executeRawUnsafe(`CREATE TRIGGER "${objectName}" BEFORE INSERT ON "FestivalLogo" FOR EACH ROW EXECUTE FUNCTION "${objectName}"()`);
    triggerCreated = true;
    await assert.rejects(applyReviewedLogos(db, rows), /injected partial import failure/);
    assert.equal(await db.festivalLogo.count(), 0);
    assert.equal(await db.assetBlob.count(), beforeBlobs);
  } finally {
    await cleanupFailureInjection();
  }
  const applied = await applyReviewedLogos(db, rows);
  assert.equal(applied.bound, 47);
  assert.deepEqual(await verifyReviewedLogos(db, rows), applied);
  const timeBefore = (await db.festivalLogo.findMany({ orderBy: { festivalId: 'asc' }, select: { updatedAt: true } })).map(x => x.updatedAt.toISOString());
  assert.deepEqual(await applyReviewedLogos(db, rows), applied);
  const timeAfter = (await db.festivalLogo.findMany({ orderBy: { festivalId: 'asc' }, select: { updatedAt: true } })).map(x => x.updatedAt.toISOString());
  assert.deepEqual(timeAfter, timeBefore);
  assert.equal((await previewReviewedLogos(db, rows)).missingBindings, 0);
  await assert.rejects(verifyReviewedLogos(db, rows.map((row, index) => index === 0 ? { ...row, sha256: 'a'.repeat(64) } : row)), /parity mismatch/);
  // A real operator-edited binding fails closed; restore the disposable fixture.
  const festival = await db.festival.findUniqueOrThrow({ where: { slug: rows[0].slug }, select: { id: true } });
  await db.festivalLogo.update({ where: { festivalId: festival.id }, data: { assetHash: rows[1].sha256 } });
  try {
    await assert.rejects(previewReviewedLogos(db, rows), /Existing festival logo conflict/);
    await assert.rejects(applyReviewedLogos(db, rows), /Existing festival logo conflict/);
  } finally {
    await db.festivalLogo.update({ where: { festivalId: festival.id }, data: { assetHash: rows[0].sha256 } });
  }
});
