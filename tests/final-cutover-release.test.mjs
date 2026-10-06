import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateCutoverAudit, stripDynamicRelease, assertDynamicReleaseAbsent } from '../scripts/deploy/prepare-db-only-release.mjs';

test('parity alone cannot authorize fallback retirement', () => {
  const sha = 'a'.repeat(40);
  const report = { version: 2, kind: 'db-only-cutover', cutoverCommit: sha, preservation: { verified: true, reviewedDifferences: true, missing: 0, conflicts: 0, fileInventoryHash: 'b'.repeat(64), databaseInventoryHash: 'c'.repeat(64) } };
  assert.throws(() => validateCutoverAudit(report, sha));
  const complete = { ...report, restore: { verified: true, backupHash: 'd'.repeat(64) } };
  validateCutoverAudit(complete, sha);
  assert.throws(() => validateCutoverAudit(complete, 'e'.repeat(40)));
  validateCutoverAudit(complete, 'e'.repeat(40), true);
  assert.throws(() => validateCutoverAudit({ ...complete, preservation: { ...complete.preservation, missing: 1 } }, sha));
  assert.throws(() => validateCutoverAudit({ ...complete, preservation: { ...complete.preservation, reviewedDifferences: false } }, sha));
});
test('DB-only release removes inventory, snapshots and logos while retaining application assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'db-only-release-'));
  try {
    for (const relative of ['data', 'public/logos', 'public/offline', 'lib/catalog']) await mkdir(path.join(root, relative), { recursive: true });
    await writeFile(path.join(root, 'public/icon.svg'), 'synthetic icon');
    await writeFile(path.join(root, 'lib/catalog/seed.ts'), 'synthetic seed');
    await assert.rejects(() => assertDynamicReleaseAbsent(root));
    await stripDynamicRelease(root);
    await assertDynamicReleaseAbsent(root);
    assert.equal(await readFile(path.join(root, 'public/icon.svg'), 'utf8'), 'synthetic icon');
  } finally { await rm(root, { recursive: true, force: true }); }
});
