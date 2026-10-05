import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { auditReviewedLogos } from '../lib/catalog/logo-import.ts';
import { runLogoImport } from '../scripts/deploy/run-reviewed-logo-import.ts';
import { requireLocalDisposableLogoDatabase } from './logo-import-db-guard.ts';

requireLocalDisposableLogoDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const writer = new PrismaClient();
const rows = await auditReviewedLogos();
const nonce = 'd'.repeat(64);
const objectName = 'production_logo_test_' + randomBytes(12).toString('hex');
let trigger = false;
let fn = false;
async function clearInjection() {
  if (trigger) { await db.$executeRawUnsafe(`DROP TRIGGER "${objectName}" ON "FestivalLogo"`); trigger = false; }
  if (fn) { await db.$executeRawUnsafe(`DROP FUNCTION "${objectName}"()`); fn = false; }
}
async function reset() {
  // Destructive fixture operations are guarded above and run only in disposable CI DBs.
  await db.festivalLogo.deleteMany();
  await db.assetBlob.deleteMany({ where: { sha256: { in: rows.map(row => row.sha256) } } });
}
async function inject(body: string) {
  await db.$executeRawUnsafe(`CREATE FUNCTION "${objectName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$`);
  fn = true;
  await db.$executeRawUnsafe(`CREATE TRIGGER "${objectName}" AFTER INSERT ON "FestivalLogo" FOR EACH ROW EXECUTE FUNCTION "${objectName}"()`);
  trigger = true;
}
test.after(async () => { try { await clearInjection(); } finally { await Promise.all([db.$disconnect(), writer.$disconnect()]); } });

// Proxy only selected operations while using the actual PostgreSQL transaction.
function interceptedDb(overrides: Partial<PrismaClient>) {
  return new Proxy(db, { get(target, key) {
    if (key in overrides) return overrides[key as keyof PrismaClient];
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test('production entrypoint: rollback, locked before-write guards, read-back, conflicts and idempotent retry', async () => {
  await reset();
  const beforeBlobs = await db.assetBlob.count();
  const preview = await runLogoImport(db, 'preview', nonce);
  assert.equal(JSON.parse(preview.output).existing, 0);
  assert.equal((await runLogoImport(db, 'verify', nonce)).ok, false);
  assert.equal((await runLogoImport(db, 'apply', nonce, 47)).ok, false);
  assert.equal(await db.festivalLogo.count(), 0);
  try {
    await inject(`IF NEW."assetHash" = '${rows[46].sha256}' THEN RAISE EXCEPTION 'private URL secret'; END IF;`);
    const result = await runLogoImport(db, 'apply', nonce, 0);
    assert.equal(JSON.parse(result.output).status, 'write-rejected');
    assert.doesNotMatch(result.output, /private|URL|secret/);
    assert.equal(await db.festivalLogo.count(), 0);
    assert.equal(await db.assetBlob.count(), beforeBlobs);
  } finally { await clearInjection(); }
  // A trigger corrupts a stored payload: exact verification inside the transaction rolls back.
  try {
    await inject(`IF NEW."assetHash" = '${rows[46].sha256}' THEN UPDATE "AssetBlob" SET "bytes" = decode('00', 'hex') WHERE "sha256" = '${rows[0].sha256}'; END IF;`);
    assert.equal(JSON.parse((await runLogoImport(db, 'apply', nonce, 0)).output).status, 'write-rejected');
    assert.equal(await db.festivalLogo.count(), 0);
    assert.equal(await db.assetBlob.count(), beforeBlobs);
  } finally { await clearInjection(); }

  // A conflicting preexisting blob with a pinned hash must never be trusted or overwritten.
  // The DB enforces byte digest and size, but a wrong valid MIME remains possible.
  const wrongMime = rows[0].mimeType === 'image/png' ? 'image/jpeg' : 'image/png';
  await db.assetBlob.create({ data: { sha256: rows[0].sha256, mimeType: wrongMime,
    sizeBytes: rows[0].sizeBytes, bytes: Uint8Array.from(rows[0].bytes) } });
  assert.equal(JSON.parse((await runLogoImport(db, 'apply', nonce, 0)).output).status, 'write-rejected');
  assert.equal(await db.festivalLogo.count(), 0);
  assert.equal(await db.assetBlob.count(), beforeBlobs + 1);
  assert.equal((await db.assetBlob.findUniqueOrThrow({ where: { sha256: rows[0].sha256 } })).mimeType, wrongMime);
  await reset();

  // Change festival coverage between the outside preview and transaction. It must be re-read.
  const festival = await db.festival.findUniqueOrThrow({ where: { slug: rows[0].slug } });
  const renamed = interceptedDb({ $transaction: (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    await db.festival.update({ where: { id: festival.id }, data: { slug: 'changed-test-coverage' } });
    return db.$transaction(callback, options);
  }) as PrismaClient['$transaction'] });
  try {
    assert.equal(JSON.parse((await runLogoImport(renamed, 'apply', nonce, 0)).output).status, 'write-rejected');
    assert.equal(await db.festivalLogo.count(), 0);
  } finally { await db.festival.update({ where: { id: festival.id }, data: { slug: rows[0].slug } }); }

  // Insert one matching binding after outside preview. Expected=0 must fail under locks.
  const changedCount = interceptedDb({ $transaction: (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    await db.assetBlob.create({ data: { sha256: rows[0].sha256, mimeType: rows[0].mimeType, sizeBytes: rows[0].sizeBytes, bytes: new Uint8Array(rows[0].bytes) } });
    await db.festivalLogo.create({ data: { festivalId: festival.id, assetHash: rows[0].sha256 } });
    return db.$transaction(callback, options);
  }) as PrismaClient['$transaction'] });
  assert.equal(JSON.parse((await runLogoImport(changedCount, 'apply', nonce, 0)).output).status, 'write-rejected');
  assert.equal(await db.festivalLogo.count(), 1);
  await reset();

  // Real concurrent catalog writer waits on the table lock until import commit.
  let pendingWriter: Promise<number> | undefined;
  let blocked = false;
  const locked = interceptedDb({ $transaction: (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
    return db.$transaction(async tx => {
      let started = false;
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === 'festival') return { ...target.festival, findMany: async (...args: Parameters<typeof target.festival.findMany>) => {
          if (!started) {
            started = true;
            pendingWriter = writer.$executeRawUnsafe('UPDATE "Festival" SET "slug" = "slug" WHERE "id" = $1', festival.id).then(count => count);
            for (let attempt = 0; attempt < 100; attempt++) {
              const locks = await tx.$queryRawUnsafe<{ blocked: bigint }[]>('SELECT count(*) AS blocked FROM pg_locks WHERE relation = \'"Festival"\'::regclass AND NOT granted');
              if (Number(locks[0].blocked) > 0) { blocked = true; break; }
              await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.equal(blocked, true, 'competing writer must wait on import table lock');
          }
          return target.festival.findMany(...args);
        } };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      return callback(wrapped);
    }, options);
  }) as PrismaClient['$transaction'] });
  const applied = await runLogoImport(locked, 'apply', nonce, 0);
  await pendingWriter;
  assert.equal(blocked, true);
  assert.equal(applied.ok, true, applied.output);
  assert.equal(JSON.parse(applied.output).postVerified, 47);
  const timestamps = await db.festivalLogo.findMany({ orderBy: { festivalId: 'asc' }, select: { updatedAt: true } });
  assert.equal((await runLogoImport(db, 'apply', nonce, 47)).ok, true);
  assert.deepEqual(await db.festivalLogo.findMany({ orderBy: { festivalId: 'asc' }, select: { updatedAt: true } }), timestamps);
  assert.equal((await runLogoImport(db, 'verify', nonce)).ok, true);

  await db.festivalLogo.update({ where: { festivalId: festival.id }, data: { assetHash: rows[1].sha256 } });
  try { assert.equal((await runLogoImport(db, 'apply', nonce, 47)).ok, false); }
  finally { await db.festivalLogo.update({ where: { festivalId: festival.id }, data: { assetHash: rows[0].sha256 } }); }

  // Force the post-commit read to fail. Writes remain committed; result must never be success.
  await reset();
  let committed = false;
  const failedReadback = interceptedDb({
    festivalLogo: new Proxy(db.festivalLogo, { get(target, key) {
      if (key === 'findMany') return (...args: Parameters<typeof target.findMany>) => {
        if (committed) throw new Error('private database URL');
        return target.findMany(...args);
      };
      return Reflect.get(target, key);
    } }),
    $transaction: (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
      if (committed) throw new Error('private database URL');
      const value = await db.$transaction(callback, options); committed = true; return value;
    }) as PrismaClient['$transaction'],
  });
  const failed = await runLogoImport(failedReadback, 'apply', nonce, 0);
  assert.equal(failed.ok, false);
  assert.equal(JSON.parse(failed.output).status, 'post-commit-verify-failed');
  assert.doesNotMatch(failed.output, /private|URL/);
  assert.equal(await db.festivalLogo.count(), 47);
  assert.equal((await runLogoImport(db, 'verify', nonce)).ok, true);
});
