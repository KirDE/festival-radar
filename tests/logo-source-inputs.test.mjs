import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { verifyLogoSourceInputs } from '../scripts/deploy/verify-logo-source-inputs.mjs';

test('release source guard preserves all 47 immutable binaries and rejects incomplete/substituted releases', async () => {
  await verifyLogoSourceInputs();
  const root = await mkdtemp(path.join(os.tmpdir(), 'logo-release-'));
  try {
    await cp('data', path.join(root, 'data'), { recursive: true });
    await cp('source-inputs', path.join(root, 'source-inputs'), { recursive: true });
    await verifyLogoSourceInputs(root);
    const file = path.join(root, 'source-inputs/reviewed-logos/2000trees.png');
    const bytes = await readFile(file);
    await writeFile(file, Buffer.from('changed'));
    await assert.rejects(verifyLogoSourceInputs(root));
    await rm(file);
    await assert.rejects(verifyLogoSourceInputs(root));
    await symlink(path.resolve('source-inputs/reviewed-logos/2000trees.png'), file);
    await assert.rejects(verifyLogoSourceInputs(root));
    await rm(file);
    await writeFile(file, bytes);
    await writeFile(path.join(root, 'source-inputs/reviewed-logos/extra.png'), bytes);
    await assert.rejects(verifyLogoSourceInputs(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('UI/public sources contain no retired static URLs or public source directory references', async () => {
  async function scan(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) await scan(filename);
      else if (/\.(tsx?|m?js|json|html|css)$/.test(filename)) {
        const text = await readFile(filename, 'utf8');
        assert.doesNotMatch(text, /(?<!\/api)\/logos\/|public\/logos|staticSrc/, filename);
      }
    }
  }
  for (const directory of ['components', 'data', 'public', 'app']) await scan(directory);
});

test('packaging and install verify non-public sources before release activation', async () => {
  const packager = await readFile('scripts/deploy/package-release.sh', 'utf8');
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  assert.match(packager, /cp -a data lib source-inputs/);
  assert.match(packager, /\$stage\/app\/scripts\/deploy\/verify-logo-source-inputs\.mjs/);
  assert.ok(installer.indexOf('"$release/scripts/deploy/verify-logo-source-inputs.mjs"') < installer.indexOf('logo_import_snapshot_unit'));
  const fetcher = await readFile('scripts/fetch-festival-logos.mjs', 'utf8');
  assert.match(fetcher, /\.logo-candidates/);
  assert.doesNotMatch(fetcher, /public\/logos|source-inputs\/reviewed-logos/);
});
