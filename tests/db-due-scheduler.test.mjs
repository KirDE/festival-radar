import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runTick } from '../scripts/db-due-tick.mjs';

test('bounded tick drains on idle and fetch failure; audits drain failure separately', async () => {
  for (const fetch of ['idle', 'ok', 'failed', 'oversized']) {
    const calls = [];
    const counts = await runTick(async operation => {
      calls.push(operation);
      if (operation === 'drain') return { delivered: 100 };
      if (fetch === 'failed') throw new Error('private');
      return fetch === 'idle' ? { status: 'NO_DUE_SOURCES', attempted: 0 }
        : { status: 'COMPLETED', attempted: fetch === 'ok' ? 1 : 2, fetchErrors: 0 };
    });
    assert.deepEqual(calls, ['fetch', 'drain']);
    assert.equal(counts.idle, Number(fetch === 'idle'));
    assert.equal(counts.fetch_error, Number(['failed', 'oversized'].includes(fetch)));
    assert.equal(counts.drain_ok, 1);
    assert.equal(counts.delivered, 100);
  }
  const failed = await runTick(async op => {
    if (op === 'fetch') return { status: 'NO_DUE_SOURCES', attempted: 0 };
    return { delivered: 101 };
  });
  assert.equal(failed.drain_error, 1);
  assert.equal(failed.idle, 1);
});

async function harness() {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-scheduler-'));
  const root = path.join(dir, 'root'); const state = path.join(dir, 'state'); const bin = path.join(dir, 'bin');
  const sha = 'a'.repeat(40); const release = path.join(root, 'releases', sha);
  await mkdir(release, { recursive: true }); await mkdir(state, { mode: 0o755 }); await mkdir(bin);
  await mkdir(path.join(root, 'shared/ingestion'), { recursive: true });
  await writeFile(path.join(root, 'shared/ingestion/source-fetch.lock'), '', { mode: 0o644 });
  await symlink(release, path.join(root, 'current')); await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
  await writeFile(path.join(state, 'mode'), 'legacy\n', { mode: 0o644 });
  await writeFile(path.join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'systemctl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_DIR/log"
if [[ "$*" == *"$FAIL_MATCH"* && -n "$FAIL_MATCH" ]]; then exit 1; fi
case "$1" in
  show) if [[ -f "$TEST_DIR/active-$4" ]]; then echo active; else echo inactive; fi ;;
  is-enabled) echo enabled ;;
  enable) touch "$TEST_DIR/active-$3" ;;
  disable) rm -f "$TEST_DIR"/active-*.timer ;;
  stop) for arg in "\${@:2}"; do rm -f "$TEST_DIR/active-$arg"; done ;;
  start) printf '%s\\n' "$TEST_TICK" > "$TEST_DIR/audit/tick.audit"; exit "\${TICK_STATUS:-0}" ;;
esac
`, { mode: 0o755 });
  await writeFile(path.join(bin, 'curl'), '#!/bin/sh\nprintf \'{"legacyRouteInactive":%s,"commit":"%s"}\' "$CLOSED" "$PROBE_SHA"\n', { mode: 0o755 });
  let script = await readFile('scripts/deploy/db-due-scheduler', 'utf8');
  script = script.replace('root=/opt/festival-radar', 'root=' + root)
    .replace('state=/var/lib/festival-radar-scheduler', 'state=' + state)
    .replace('/run/festival-radar-activation.lock', path.join(dir, 'deployment.lock'))
    .replace('/run/festival-radar-db-due', path.join(dir, 'audit'))
    .replaceAll('0:755', process.getuid() + ':755').replaceAll('0:644', process.getuid() + ':644')
    .replaceAll('0:700', process.getuid() + ':700').replaceAll('0:600', process.getuid() + ':600')
    .replace('www-data:640', process.env.USER + ':644')
    .replace('install -d -o root -g root -m 0700', 'install -d -m 0700');
  // Use numeric lock validation so USER is not needed by the test host.
  script = script.replace('stat -c %U:%a "$lock"', 'stat -c %u:%a "$lock"').replace(process.env.USER + ':644', process.getuid() + ':644');
  const file = path.join(dir, 'scheduler'); await writeFile(file, script);
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_DIR: dir, FAIL_MATCH: '', CLOSED: 'true', PROBE_SHA: sha,
    TEST_TICK: 'DB_DUE_TICK fetch_ok=0 idle=1 fetch_error=0 drain_ok=1 drain_error=0 delivered=3' };
  const run = (action, extra = {}) => spawnSync('bash', [file, sha, action], { encoding: 'utf8', env: { ...env, ...extra } });
  return { dir, root, state, sha, run, env };
}

test('cutover gates exact SHA and inactive legacy timer/service; partial failures inhibit both paths', async () => {
  const h = await harness();
  try {
    const result = h.run('db-due'); assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(h.state, 'mode'), 'utf8'), 'db-due\n');
    const log = await readFile(path.join(h.dir, 'log'), 'utf8');
    assert.ok(log.indexOf('stop festival-radar-collection@ingestion.service') < log.indexOf('enable --now festival-radar-db-due.timer'));
    assert.equal(h.run('legacy', { CLOSED: 'false' }).status, 0);
    for (const extra of [{ PROBE_SHA: 'b'.repeat(40) }, { CLOSED: 'false' }, { FAIL_MATCH: 'stop festival-radar-collection@ingestion.service' }, { FAIL_MATCH: 'enable --now festival-radar-db-due.timer' }]) {
      await writeFile(path.join(h.state, 'mode'), 'legacy\n');
      assert.notEqual(h.run('db-due', extra).status, 0);
      await assert.rejects(readFile(path.join(h.state, 'mode')), { code: 'ENOENT' });
      await assert.rejects(readFile(path.join(h.dir, 'active-festival-radar-db-due.timer')), { code: 'ENOENT' });
    }
    assert.equal(h.run('db-due').status, 0); // explicit recovery from inhibited state
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('tick validates idle/failure audits and health distinguishes stale, missing and errors', async () => {
  const h = await harness();
  try {
    assert.equal(h.run('tick').status, 73);
    await writeFile(path.join(h.state, 'mode'), 'db-due\n');
    assert.equal(h.run('tick').status, 0);
    let health = h.run('health'); assert.equal(health.status, 0, health.stderr);
    assert.match(health.stdout, /"tickMissing":0,"tickStale":0,"fetchError":0,"drainError":0/);
    assert.equal(h.run('tick', { TEST_TICK: 'DB_DUE_TICK fetch_ok=0 idle=0 fetch_error=1 drain_ok=1 drain_error=0 delivered=4', TICK_STATUS: '1' }).status, 1);
    assert.match(h.run('health').stdout, /"fetchError":1,"drainError":0/);
    // A ten-minute idle interval plus a long but bounded tick must not
    // falsely mark the most recent completed heartbeat stale.
    await writeFile(path.join(h.state, 'last-tick'), `${Math.floor(Date.now() / 1000) - 1900} 0 0\n`);
    assert.match(h.run('health').stdout, /"tickMissing":0,"tickStale":0/);
    await writeFile(path.join(h.state, 'last-tick'), `${Math.floor(Date.now() / 1000) - 2500} 0 0\n`);
    assert.match(h.run('health').stdout, /"tickMissing":0,"tickStale":1/);
    await writeFile(path.join(h.state, 'last-tick'), '1 0 1\n');
    assert.match(h.run('health').stdout, /"tickMissing":0,"tickStale":1,"fetchError":0,"drainError":1/);
    await writeFile(path.join(h.state, 'last-tick'), 'private-malformed\n');
    assert.match(h.run('health').stdout, /"tickMissing":1,"tickStale":1/);
    for (const record of ['private', h.env.TEST_TICK + '\nsecret', h.env.TEST_TICK.replace('delivered=3', 'delivered=101'), h.env.TEST_TICK + '\0']) {
      const result = h.run('tick', { TEST_TICK: record.includes('\0') ? h.env.TEST_TICK + '\n' : record });
      assert.equal(result.status, 6); assert.equal(result.stdout, '');
    }
    await writeFile(path.join(h.dir, 'active-festival-radar-collection@ingestion.service'), '');
    assert.equal(h.run('tick').status, 6);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('queued legacy request checks mode inside flock after cutover, including force', async () => {
  const h = await harness();
  try {
    const lock = path.join(h.root, 'shared/ingestion/source-fetch.lock');
    let legacy = await readFile('scripts/deploy/run-legacy-ingestion.sh', 'utf8');
    legacy = legacy.replace('/var/lib/festival-radar-scheduler/mode', path.join(h.state, 'mode')).replace('0:644', process.getuid() + ':644');
    const file = path.join(h.dir, 'legacy'); await writeFile(file, legacy);
    const result = spawnSync('bash', ['-c', `
exec 8>"$1"
flock 8
bash "$2" "$3" db-due
status=$?
[[ "$status" == 5 ]] || exit 1
flock "$1" bash "$4" bash -c 'touch "$1"' bash "$5" --force &
queued=$!
printf 'db-due\\n' > "$6"
flock -u 8
wait "$queued"
[[ "$?" == 73 ]]
`, 'bash', lock, path.join(h.dir, 'scheduler'), h.sha, file, path.join(h.dir, 'fetched'), path.join(h.state, 'mode')], { encoding: 'utf8', env: h.env });
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(readFile(path.join(h.dir, 'fetched')), { code: 'ENOENT' });
    await rm(path.join(h.state, 'mode'));
    assert.equal(spawnSync('bash', [file, 'true', '--force']).status, 73);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('deployment installs due assets without activating timer; scheduler rollback restores assets', async () => {
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  assert.doesNotMatch(installer, /systemctl enable[^\n]*db-due/);
  assert.match(installer, /if \[\[ "\$scheduler_mode" == legacy/);
  const dir = await mkdtemp(path.join(tmpdir(), 'scheduler-assets-'));
  try {
    const assets = [path.join(dir, 'timer'), path.join(dir, 'service'), path.join(dir, 'wrapper')];
    await mkdir(path.join(dir, 'backup')); await writeFile(assets[0], 'old timer');
    const result = spawnSync('bash', ['-c', 'source "$1"; scheduler_assets=("$2" "$3" "$4"); systemctl() { :; }; scheduler_snapshot_assets "$5"; for asset in "${scheduler_assets[@]}"; do printf new > "$asset"; done; scheduler_restore_assets "$5"', 'bash', path.resolve('scripts/deploy/db-due-scheduler-assets.sh'), ...assets, path.join(dir, 'backup')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(assets[0], 'utf8'), 'old timer');
    await assert.rejects(readFile(assets[1]), { code: 'ENOENT' }); await assert.rejects(readFile(assets[2]), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('DB-due timer is ten minutes with a bounded long-tick stale window', async () => {
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  const timer = installer.slice(installer.indexOf('Description=Opt-in Festival Radar DB due schedule'));
  assert.match(timer, /OnBootSec=10min\nOnUnitInactiveSec=10min\nAccuracySec=15s/);
  const timeout = Number(installer.match(/Description=Serialized bounded Festival Radar DB due tick[\s\S]*?TimeoutStartSec=(\d+)/)?.[1]);
  assert.ok(timeout >= 1100 + 120 + 60 && timeout <= 1400);
  const scheduler = await readFile('scripts/deploy/db-due-scheduler', 'utf8');
  assert.match(scheduler, /now - 10#\$stamp <= 2400/);
});

test('tick CLI runs from relative path and symlink; rejects overrides before touching DB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-entrypoint-'));
  try {
    const link = path.join(dir, 'tick.mjs'); await symlink(path.resolve('scripts/db-due-tick.mjs'), link);
    for (const file of ['scripts/db-due-tick.mjs', link]) {
      const result = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
      assert.equal(result.status, 2, result.stderr);
      const rejected = spawnSync(process.execPath, [file, '--force'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'must-not-be-used' } });
      assert.equal(rejected.status, 2, rejected.stderr);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deployment dispatcher exposes only fixed exact-SHA scheduler modes', async () => {
  const dispatcher = await readFile('scripts/deploy/activate-release', 'utf8');
  for (const [action, mode] of [['due-switch-db', 'db-due'], ['due-switch-legacy', 'legacy'], ['due-scheduler-health', 'health']]) {
    assert.ok(dispatcher.includes(`${action}) exec /usr/local/libexec/festival-radar/db-due-scheduler "$commit" ${mode} ;;`));
  }
  assert.ok(dispatcher.includes('[[ "$commit" =~ ^[0-9a-f]{40}$ ]]'));
});

test('HTTP route places mode guard inside flock; forced workflow uses the same gate and fixed drain cap', async () => {
  const route = await readFile('app/api/ingestion/run/route.ts', 'utf8');
  assert.match(route, /source-fetch.lock", "\/bin\/bash", "scripts\/deploy\/run-legacy-ingestion.sh", process.execPath/);
  assert.ok(route.indexOf('if (!await legacyRouteActive())') < route.indexOf('if (parsed.data.force)'));
  const workflow = await readFile('.github/workflows/ingestion.yml', 'utf8');
  assert.match(workflow, /FORCE: "false"/);
  assert.match(workflow, /group: festival-radar-production/);
  const drain = await readFile('scripts/drain-ingestion-notifications.mjs', 'utf8');
  assert.match(drain, /drainIngestionNotificationOutbox\(db, \{ limit: 100 \}\)/);
});

test('deployment preserves db-due and inhibited mode and enables legacy only for legacy mode', async () => {
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  const start = installer.indexOf('scheduler_state=/var/lib/festival-radar-scheduler');
  const end = installer.indexOf('install -m 0600 "$env_source"', start);
  const initialize = installer.slice(start, end);
  const branch = installer.slice(installer.indexOf('if [[ "$scheduler_mode" == legacy ]]; then'), installer.indexOf('systemctl restart "$service"\nsystemctl enable'));
  const dir = await mkdtemp(path.join(tmpdir(), 'due-deploy-mode-'));
  try {
    await mkdir(path.join(dir, 'state'), { mode: 0o755 });
    for (const mode of ['legacy', 'db-due', null]) {
      const file = path.join(dir, 'state/mode');
      if (mode) await writeFile(file, mode + '\n', { mode: 0o644 }); else await rm(file, { force: true });
      const script = 'set -euo pipefail; systemctl() { printf "%s\\n" "$*"; }; ' + initialize
        .replace('scheduler_state=/var/lib/festival-radar-scheduler', 'scheduler_state="$1/state"')
        .replace('0:755', process.getuid() + ':755').replace('0:644', process.getuid() + ':644')
        .replace('/etc/systemd/system/festival-radar-db-due.timer', path.join(dir, 'absent-timer'))
        + '\nservice=festival-radar\n' + branch;
      const result = spawnSync('bash', ['-c', script, 'bash', dir], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.includes('enable --now festival-radar-collection-ingestion.timer'), mode === 'legacy');
      if (mode) assert.equal(await readFile(file, 'utf8'), mode + '\n');
      else await assert.rejects(readFile(file), { code: 'ENOENT' });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
