import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { festivals } from '../data/festivals.ts';
import { audit, REVIEWED_DIGEST, runLogoImport } from '../scripts/deploy/run-reviewed-logo-import.ts';

const nonce = 'b'.repeat(64);
const rows = festivals.map(({ slug }) => ({ slug }));

test('pinned source preview is read-only and returns bounded audit', async () => {
  const db = { festival: { findMany: async () => rows }, festivalLogo: { findMany: async () => [] },
    assetBlob: { create: () => { throw new Error('write forbidden'); } },
    $transaction: () => { throw new Error('write forbidden'); },
  } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'preview', nonce);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.output), { operation: 'reviewed-logo-import', mode: 'preview', nonce,
    status: 'ok', inventoryDigest: REVIEWED_DIGEST, sourceFiles: 47, existing: 0 });
});

test('verify rejects incomplete bindings and never writes', async () => {
  const db = { festivalLogo: { findMany: async () => [] }, $transaction: () => { throw new Error('write forbidden'); } } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'verify', nonce);
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(result.output).status, 'database-rejected');
});

test('database failure is sanitized and invalid nonce fails before access', async () => {
  const db = { festival: { findMany: () => { throw new Error('secret URL password'); } } } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'preview', nonce);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.output, /secret|password|URL/);
  await assert.rejects(runLogoImport(db, 'preview', 'oops'), /Invalid logo operation nonce/);
  assert.throws(() => audit('preview', nonce, 'ok', 48), /Invalid logo audit/);
});

test('direct runner rejects write mode before database access', () => {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/deploy/run-reviewed-logo-import.ts', 'apply'],
    { encoding: 'utf8', env: { ...process.env, LOGO_IMPORT_NONCE: nonce, DEPLOYED_COMMIT: 'a'.repeat(40), DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1/festival_integration' } });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /logo operation guard rejected/);
  assert.equal(child.stdout, '');
});

test('root dispatcher matches only exact fixed audit records', () => {
  const script = readFileSync('scripts/deploy/start-logo-import', 'utf8');
  const patterns = script.split(String.fromCharCode(10))
    .filter(line => line.startsWith('ok_pattern=') || line.startsWith('fail_pattern='))
    .join(String.fromCharCode(10));
  const base = { operation: 'reviewed-logo-import', mode: 'preview', nonce, status: 'ok', inventoryDigest: REVIEWED_DIGEST, sourceFiles: 47 };
  for (const [record, expected] of [
    [{ ...base, existing: 0 }, 'ok'],
    [{ ...base, status: 'database-rejected' }, 'fail'],
    [{ ...base, existing: 48 }, ''],
    [{ ...base, existing: 0, extra: 'leak' }, ''],
    [{ ...base, nonce: 'a'.repeat(64), existing: 0 }, ''],
  ] as const) {
    const shell = 'mode=preview; nonce=' + nonce + '; ' + patterns + '; ' +
      '[[ "$RECORD" =~ $ok_pattern ]] && echo ok; [[ "$RECORD" =~ $fail_pattern ]] && echo fail';
    const result = spawnSync('bash', ['-c', shell], { encoding: 'utf8',
      env: { ...process.env, RECORD: 'LOGO_IMPORT_AUDIT ' + JSON.stringify(record) } });
    assert.equal(result.stdout.trim(), expected);
  }
});
