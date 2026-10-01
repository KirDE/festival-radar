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

test('operator wrapper gates release and forwards only a valid count-only health audit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-due-wrapper-'));
  try {
    const root = path.join(dir, 'root');
    const sha = 'a'.repeat(40);
    const release = path.join(root, 'releases', sha);
    const unit = path.join(dir, 'db-due@.service');
    const bin = path.join(dir, 'bin');
    const audit = path.join(dir, 'audit', 'health.audit');
    const log = path.join(dir, 'systemctl.log');
    await mkdir(release, { recursive: true });
    await mkdir(bin);
    await symlink(release, path.join(root, 'current'));
    await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
    await writeFile(unit, '[Service]');
    await writeFile(path.join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
    await writeFile(path.join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_SYSTEMCTL_LOG"\n[ "$2" = festival-radar-db-due@health.service ] || exit 0\n[ "${TEST_FAIL:-0}" = 0 ] || exit 1\nprintf "%s\\n" "$TEST_AUDIT" > "$TEST_AUDIT_FILE"\n', { mode: 0o755 });
    let wrapper = await readFile('scripts/deploy/start-db-due', 'utf8');
    wrapper = wrapper.replace('root=/opt/festival-radar', 'root=' + root)
      .replace('/run/festival-radar-activation.lock', path.join(dir, 'lock'))
      .replace('/etc/systemd/system/festival-radar-db-due@.service', unit)
      .replace('/run/festival-radar-db-due', path.join(dir, 'audit'))
      .replaceAll('0:700', process.getuid() + ':700')
      .replaceAll('0:600', process.getuid() + ':600');
    const file = path.join(dir, 'wrapper');
    await writeFile(file, wrapper, { mode: 0o755 });
    const counts = JSON.stringify({ due: 1, queueLaggedOverHour: 2, active: 3, expired: 4, error: 5, outboxPending: 6, outboxLaggedOverHour: 7, unknownParserKeys: 8 });
    const run = (args, extra = {}) => spawnSync('bash', [file, ...args], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_SYSTEMCTL_LOG: log, TEST_AUDIT_FILE: audit, TEST_AUDIT: counts, ...extra } });
    assert.equal(run(['b'.repeat(40), 'health']).status, 4);
    assert.equal(run([sha, 'other']).status, 2);
    const result = run([sha, 'health']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'DB_DUE_HEALTH ' + counts + '\n');
    for (const bad of [counts + '\nsecret', counts.replace('1,', '"secret",'), '', counts + '\n' + counts, counts + ' private']) {
      const rejected = run([sha, 'health'], { TEST_AUDIT: bad });
      assert.equal(rejected.status, 6);
      assert.equal(rejected.stdout, '');
      assert.doesNotMatch(rejected.stderr, /secret|private/);
    }
    assert.equal(run([sha, 'health'], { TEST_FAIL: '1' }).status, 6);
    assert.equal((await readFile(log, 'utf8')).split('\n').filter(Boolean).length, 7);
    await rm(path.join(root, 'current'));
    assert.equal(run([sha, 'drain']).status, 4);
    assert.equal((await readFile(log, 'utf8')).split('\n').filter(Boolean).length, 7);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
