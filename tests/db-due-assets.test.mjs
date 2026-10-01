import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('failed-health asset rollback restores prior unit/wrapper or removes newly installed assets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-due-assets-'));
  try {
    const helper = path.resolve('scripts/deploy/db-due-assets.sh');
    for (const prior of [true, false]) {
      const unit = path.join(dir, 'unit');
      const wrapper = path.join(dir, 'wrapper');
      const backup = path.join(dir, 'backup');
      await mkdir(backup);
      if (prior) {
        await writeFile(unit, 'old pinned unit');
        await writeFile(wrapper, 'old wrapper');
      }
      const script = 'source "$1"; db_due_snapshot_assets "$2" "$3" "$4"; printf new > "$2"; printf new > "$3"; db_due_restore_assets "$2" "$3" "$4"';
      const result = spawnSync('bash', ['-c', script, 'bash', helper, unit, wrapper, backup], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      if (prior) {
        assert.equal(await readFile(unit, 'utf8'), 'old pinned unit');
        assert.equal(await readFile(wrapper, 'utf8'), 'old wrapper');
      } else {
        await assert.rejects(readFile(unit, 'utf8'), { code: 'ENOENT' });
        await assert.rejects(readFile(wrapper, 'utf8'), { code: 'ENOENT' });
      }
      await rm(backup, { recursive: true });
      await rm(unit, { force: true });
      await rm(wrapper, { force: true });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('operator wrapper rejects mismatches and starts exactly one fixed-mode unit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-due-wrapper-'));
  try {
    const root = path.join(dir, 'root');
    const release = path.join(root, 'releases', 'a'.repeat(40));
    const unit = path.join(dir, 'db-due@.service');
    const bin = path.join(dir, 'bin');
    await mkdir(release, { recursive: true });
    await mkdir(bin);
    await symlink(release, path.join(root, 'current'));
    await writeFile(path.join(release, 'DEPLOYED_COMMIT'), 'a'.repeat(40));
    await writeFile(unit, '[Service]');
    await writeFile(path.join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
    await writeFile(path.join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_SYSTEMCTL_LOG"\n', { mode: 0o755 });
    let wrapper = await readFile('scripts/deploy/start-db-due', 'utf8');
    wrapper = wrapper.replace('root=/opt/festival-radar', 'root=' + root)
      .replace('/run/festival-radar-activation.lock', path.join(dir, 'lock'))
      .replace('/etc/systemd/system/festival-radar-db-due@.service', unit);
    const file = path.join(dir, 'wrapper');
    const log = path.join(dir, 'systemctl.log');
    await writeFile(file, wrapper, { mode: 0o755 });
    const run = (...args) => spawnSync('bash', [file, ...args], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_SYSTEMCTL_LOG: log } });
    assert.equal(run('b'.repeat(40), 'health').status, 4);
    assert.equal(run('a'.repeat(40), 'other').status, 2);
    assert.equal(run('a'.repeat(40), 'health').status, 0);
    assert.equal(await readFile(log, 'utf8'), 'start festival-radar-db-due@health.service\n');
    await rm(path.join(root, 'current'));
    assert.equal(run('a'.repeat(40), 'drain').status, 4);
    assert.equal(await readFile(log, 'utf8'), 'start festival-radar-db-due@health.service\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
