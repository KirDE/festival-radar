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
    await writeFile(path.join(root, 'lib/catalog/backfill.ts'), '// stale synthetic helper');
    await assert.rejects(() => assertDynamicReleaseAbsent(root));
    await stripDynamicRelease(root);
    await assertDynamicReleaseAbsent(root);
    assert.equal(await readFile(path.join(root, 'public/icon.svg'), 'utf8'), 'synthetic icon');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('packager builds a DB-only archive from a tree with no Git catalogue inputs', async () => {
  // Exercise actual staging/copy/archive logic with local synthetic build output.
  // Runtime bundling and pip are stubbed: no server, network or provider actions.
  const { cp, chmod } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execute = promisify(execFile);
  const root = await mkdtemp(path.join(tmpdir(), 'git-retirement-package-'));
  const sha = 'a'.repeat(40);
  try {
    for (const directory of ['scripts', 'lib', 'prisma', 'public']) {
      await cp(directory, path.join(root, directory), { recursive: true });
    }
    for (const file of ['package.json', 'package-lock.json', 'requirements.txt']) await cp(file, path.join(root, file));
    for (const directory of ['.next/standalone', '.next/static', 'bin']) await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, '.next/standalone/server.js'), '// synthetic build artifact');
    await writeFile(path.join(root, '.next/static/synthetic.js'), '// synthetic static asset');
    await writeFile(path.join(root, 'scripts/deploy/bundle-node-runtime.sh'), `#!/bin/sh
mkdir -p "$1/npm/bin"
printf '%s' '// synthetic npm' > "$1/npm/bin/npm-cli.js"
printf '%s' 'synthetic runtime' > "$1/node"
printf '%s' 'test' > "$1/NPM_VERSION"
`);
    await chmod(path.join(root, 'scripts/deploy/bundle-node-runtime.sh'), 0o755);
    await writeFile(path.join(root, 'bin/python3'), `#!/bin/sh
while [ "$1" != --target ]; do shift; done
shift
mkdir -p "$1/requests"
printf '%s' '# synthetic wheel' > "$1/requests/__init__.py"
`);
    await chmod(path.join(root, 'bin/python3'), 0o755);
    const receipt = path.join(root, 'receipt.json');
    await writeFile(receipt, JSON.stringify({ version: 2, kind: 'db-only-cutover', cutoverCommit: sha,
      preservation: { verified: true, reviewedDifferences: true, missing: 0, conflicts: 0, fileInventoryHash: 'b'.repeat(64), databaseInventoryHash: 'c'.repeat(64) },
      restore: { verified: true, backupHash: 'd'.repeat(64) } }));
    const archive = path.join(root, 'release.tar.gz');
    const env = { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, DB_ONLY_RELEASE: 'true', DB_ONLY_CUTOVER_AUDIT: receipt };
    await execute('bash', ['scripts/deploy/package-release.sh', sha, archive], { cwd: root, env });
    const { stdout: contents } = await execute('tar', ['-tzf', archive]);
    assert.doesNotMatch(contents, /^app\/(?:data\/|tests\/|public\/(?:logos|offline)\/|lib\/catalog\/(?:seed|backfill|logo-import)\.ts)/m);
    assert.doesNotMatch(contents, /(?:run-source-backfill|run-reviewed-logo-import|audit-file-db-preservation|import-operational-state)\./);
    for (const file of ['lib/catalog/repository.ts', 'lib/catalog/logo-assets.ts', 'lib/catalog/operational-state.ts', 'scripts/ingest-festivals.mjs', 'scripts/playlist-worker.ts', 'scripts/audit-final-cutover.ts']) {
      assert.ok(contents.split('\n').includes('app/' + file), file);
    }
    await assert.rejects(execute('bash', ['scripts/deploy/package-release.sh', sha, archive], { cwd: root, env: { ...env, DB_ONLY_CUTOVER_AUDIT: '' } }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
