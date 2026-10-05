import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const helper = path.resolve('scripts/deploy/logo-import-assets.sh');
const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
const cleanup = installer.slice(installer.indexOf('cleanup_install()'), installer.indexOf('trap cleanup_install EXIT'));
function run(script, env) {
  const result = spawnSync('bash', ['-c', 'set -euo pipefail; source "$HELPER"; ' + script],
    { encoding: 'utf8', env: { ...process.env, HELPER: helper, ...env } });
  assert.equal(result.status, 0, result.stderr);
}

for (const present of [false, true]) {
  test((present ? 'existing unit' : 'first install') + ' restores only logo unit after failed deployment', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'logo-unit-rollback-'));
    const unit = path.join(temporary, 'festival-radar-logo-import@.service');
    const foreign = path.join(temporary, 'festival-radar-db-due@.service');
    const backup = path.join(temporary, 'backup');
    try {
      await mkdir(backup);
      await writeFile(foreign, 'unrelated DB due unit');
      if (present) await writeFile(unit, 'old logo unit', { mode: 0o640 });
      run('logo_import_snapshot_unit "$UNIT" "$BACKUP"', { UNIT: unit, BACKUP: backup });
      await writeFile(unit, 'new logo unit');
      const rollback = cleanup + '\n' +
        'systemctl() { printf "%s" "$*" > "$TEMP/reload"; }; ' +
        'logo_import_unit_armed=true; db_due_assets_armed=false; ' +
        'logo_import_unit="$UNIT"; logo_import_backup="$BACKUP"; db_due_backup=""; ' +
        'archive="$TEMP/archive"; env_source="$TEMP/env"; false || cleanup_install';
      run(rollback, { UNIT: unit, BACKUP: backup, TEMP: temporary });
      assert.equal(await readFile(path.join(temporary, 'reload'), 'utf8'), 'daemon-reload');
      if (present) {
        assert.equal(await readFile(unit, 'utf8'), 'old logo unit');
        assert.equal((await stat(unit)).mode & 0o777, 0o640);
      } else {
        await assert.rejects(stat(unit), { code: 'ENOENT' });
      }
      assert.equal(await readFile(foreign, 'utf8'), 'unrelated DB due unit');
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}

test('unsafe existing unit symlink refuses snapshot before install', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'logo-unit-unsafe-'));
  try {
    const unit = path.join(temporary, 'unit');
    const target = path.join(temporary, 'foreign');
    const backup = path.join(temporary, 'backup');
    await mkdir(backup);
    await writeFile(target, 'unrelated');
    const { symlink } = await import('node:fs/promises');
    await symlink(target, unit);
    const result = spawnSync('bash', ['-c', 'set -euo pipefail; source "$HELPER"; logo_import_snapshot_unit "$UNIT" "$BACKUP"'],
      { encoding: 'utf8', env: { ...process.env, HELPER: helper, UNIT: unit, BACKUP: backup } });
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(target, 'utf8'), 'unrelated');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('installer restores logo unit in EXIT cleanup and health rollback; clean deploy disarms it', async () => {
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  const packager = await readFile('scripts/deploy/package-release.sh', 'utf8');
  const cleanup = installer.slice(installer.indexOf('cleanup_install()'), installer.indexOf('trap cleanup_install EXIT'));
  const health = installer.slice(installer.indexOf('if [[ "$healthy" != true ]]'), installer.indexOf('find "$app_root/releases"'));
  assert.match(cleanup, /logo_import_unit_armed.*true[\s\S]*logo_import_restore_unit/);
  assert.match(health, /logo_import_restore_unit.*logo_import_backup/);
  assert.match(health, /logo_import_unit_armed=false/);
  assert.match(installer, /logo_import_snapshot_unit.*logo_import_backup/);
  assert.match(packager, /cp scripts\/deploy\/run-source-backfill\.ts.*scripts\/deploy\/logo-import-assets\.sh/);
});

test('upgraded dispatcher fails closed if rollback returns to an older release', async () => {
  const wrapper = await readFile('scripts/deploy/start-logo-import', 'utf8');
  const updater = await readFile('scripts/deploy/upgrade-deployment-assets', 'utf8');
  assert.match(updater, /DEPLOYMENT_ASSETS_COMMIT/);
  assert.match(wrapper, /DEPLOYMENT_ASSETS_COMMIT.*commit/);
  assert.match(wrapper, /DEPLOYED_COMMIT.*commit/);
  assert.match(wrapper, /WorkingDirectory=\/opt\/festival-radar\/current/);
  assert.match(wrapper, /ExecStart=\/opt\/festival-radar\/current\/\.runtime\/node/);
  assert.match(wrapper, /StandardOutput=append:\/run\/festival-radar-logo-import/);
});

for (const present of [false, true]) {
  test((present ? 'existing' : 'first') + ' unit is restored by health-failure branch', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'logo-health-rollback-'));
    const backup = path.join(temporary, 'backup');
    const unit = path.join(temporary, 'logo.service');
    const foreign = path.join(temporary, 'db-due.service');
    const previous = path.join(temporary, 'old');
    const currentRelease = path.join(temporary, 'new');
    const envFile = path.join(temporary, 'production.env');
    const previousEnv = path.join(temporary, 'previous.env');
    try {
      const { symlink, readlink } = await import('node:fs/promises');
      await mkdir(backup);
      await mkdir(previous);
      await mkdir(currentRelease);
      await symlink(currentRelease, path.join(temporary, 'current'));
      await writeFile(foreign, 'unrelated');
      await writeFile(envFile, 'new environment');
      if (present) {
        await writeFile(unit, 'old unit');
        await writeFile(previousEnv, 'old environment');
      }
      run('logo_import_snapshot_unit "$UNIT" "$BACKUP"', { UNIT: unit, BACKUP: backup });
      await writeFile(unit, 'new unit');
      const start = installer.indexOf('if [[ "$healthy" != true ]]');
      const end = installer.indexOf('\nlogo_import_unit_armed=false\ndb_due_assets_armed=false', start);
      assert.ok(start >= 0 && end > start);
      const branch = installer.slice(start, end);
      const setup = 'db_due_restore_assets() { :; }; systemctl() { :; }; ' +
        'healthy=false; previous="$PREVIOUS"; app_root="$TEMP"; ' +
        'logo_import_unit="$UNIT"; logo_import_backup="$BACKUP"; ' +
        'db_due_unit="$FOREIGN"; db_due_wrapper="$FOREIGN"; db_due_backup="$BACKUP"; ' +
        'had_previous_env="$HAD_ENV"; previous_env="$PREVIOUS_ENV"; env_file="$ENV_FILE"; service=festival-radar; ';
      const result = spawnSync('bash', ['-c', 'set -euo pipefail; source "$HELPER"; ' + setup + branch], {
        encoding: 'utf8', env: { ...process.env, HELPER: helper, UNIT: unit, BACKUP: backup,
          TEMP: temporary, PREVIOUS: previous, PREVIOUS_ENV: previousEnv, ENV_FILE: envFile,
          FOREIGN: foreign, HAD_ENV: present ? 'true' : 'false' },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(await readlink(path.join(temporary, 'current')), previous);
      if (present) {
        assert.equal(await readFile(unit, 'utf8'), 'old unit');
        assert.equal(await readFile(envFile, 'utf8'), 'old environment');
      } else {
        await assert.rejects(stat(unit), { code: 'ENOENT' });
        await assert.rejects(stat(envFile), { code: 'ENOENT' });
      }
      assert.equal(await readFile(foreign, 'utf8'), 'unrelated');
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}
