// Offline release guard: no database access, imports, fetching or writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function verifyLogoSourceInputs(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const inventory = JSON.parse(await readFile(path.join(root, 'data/reviewed-logo-inventory.json'), 'utf8'));
  const digest = createHash('sha256').update(inventory.map(row => [row.slug, row.mimeType, row.sizeBytes, row.sha256].join('\t') + '\n').join('')).digest('hex');
  assert.equal(digest, '99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456');
  assert.equal(inventory.length, 47);
  for (const part of ['source-inputs', 'source-inputs/reviewed-logos']) {
    const stat = await lstat(path.join(root, part));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  }
  const directory = path.join(root, 'source-inputs/reviewed-logos');
  assert.deepEqual((await readdir(directory)).sort(), inventory.map(row => row.file).sort());
  for (const row of inventory) {
    assert.match(row.file, /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/);
    assert.equal(row.file, `${row.slug}.png`);
    const filename = path.join(directory, row.file);
    const stat = await lstat(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    const bytes = await readFile(filename);
    assert.equal(bytes.length, row.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
  }
  await assert.rejects(lstat(path.join(root, 'public/logos')), { code: 'ENOENT' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await verifyLogoSourceInputs(); }
  catch { console.error('Pinned logo source inputs rejected'); process.exitCode = 1; }
}
