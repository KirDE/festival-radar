import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, chmod, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
function section(start, end) {
  const a = installer.indexOf(start), b = installer.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'installer section found');
  return installer.slice(a, b);
}
const snapshot = section('scheduler_state=/var/lib/festival-radar-scheduler', 'install -m 0600 "$env_source"');
const rearm = section('if [[ "$db_due_timer_was_armed" == true ]]; then', '\ndb_due_assets_armed=false');
const sha = 'a'.repeat(40);
const stub = String.raw`systemctl() {
  printf '%s\n' "$*" >> "$TEST_DIR/log"
  local kind=legacy
  [[ "$*" == *db-due* ]] && kind=due
  case "$1" in
    is-enabled) cat "$TEST_DIR/$kind-enabled" ;;
    is-active)
      if [[ "$2" == *collection@ingestion.service ]]; then echo "$LEGACY_SERVICE"
      elif [[ "$2" == *db-due-scheduler.service || "$2" == *db-due@tick.service ]]; then echo inactive
      else cat "$TEST_DIR/$kind-active"; fi ;;
    disable) if [[ "$*" == *db-due.timer* ]]; then printf disabled > "$TEST_DIR/due-enabled"; printf inactive > "$TEST_DIR/due-active"; fi ;;
    enable) if [[ "$*" == *db-due.timer* ]]; then
      printf enabled > "$TEST_DIR/due-enabled"; printf active > "$TEST_DIR/due-active"
      [[ "$FAIL_ENABLE" == false ]] || return 1
    fi ;;
    stop) : ;;
  esac
}
curl() {
  if [[ "$*" == *health/deployment/* ]]; then
    printf '{"status":"%s","database":"ok","catalog":"database","commit":"%s"}' "$HEALTH_STATUS" "$HEALTH_SHA"
  else printf '{"legacyRouteInactive":%s,"commit":"%s"}' "$CLOSURE" "$PROBE_SHA"; fi
}`;

async function fixture({ mode = 'db-due', due = 'armed', legacy = 'paused', legacyService = 'inactive', closure = 'true', probeSha = sha, healthSha = sha, healthStatus = 'ok', failEnable = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-deploy-rearm-'));
  const root = path.join(dir, 'root'), release = path.join(root, 'releases', sha), state = path.join(dir, 'state');
  await mkdir(release, { recursive: true }); await mkdir(state, { mode: 0o755 }); await chmod(state, 0o755);
  await symlink(release, path.join(root, 'current'));
  await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
  await mkdir(path.join(release, '.runtime'));
  await symlink(process.execPath, path.join(release, '.runtime/node'));
  if (mode !== null) { await writeFile(path.join(state, 'mode'), mode + '\n', { mode: 0o644 }); await chmod(path.join(state, 'mode'), 0o644); }
  if (due !== 'missing') await writeFile(path.join(dir, 'db-due.timer'), 'timer');
  if (legacy !== 'missing') await writeFile(path.join(dir, 'legacy.timer'), 'timer');
  const dueValues = due === 'armed' ? ['enabled', 'active'] : ['disabled', 'inactive'];
  const legacyValues = legacy === 'armed' ? ['enabled', 'active'] : ['disabled', 'inactive'];
  for (const [name, values] of [['due', dueValues], ['legacy', legacyValues]]) {
    await writeFile(path.join(dir, name + '-enabled'), values[0]); await writeFile(path.join(dir, name + '-active'), values[1]);
  }
  const env = { ...process.env, TEST_DIR: dir, CLOSURE: closure, PROBE_SHA: probeSha, HEALTH_SHA: healthSha, HEALTH_STATUS: healthStatus, FAIL_ENABLE: String(failEnable), LEGACY_SERVICE: legacyService };
  const pre = snapshot.replace('scheduler_state=/var/lib/festival-radar-scheduler', 'scheduler_state="$TEST_DIR/state"')
    .replaceAll('/etc/systemd/system/festival-radar-db-due.timer', '"$TEST_DIR/db-due.timer"')
    .replaceAll('/etc/systemd/system/festival-radar-collection-ingestion.timer', '"$TEST_DIR/legacy.timer"')
    .replaceAll('0:755', process.getuid() + ':755').replaceAll('0:644', process.getuid() + ':644');
  const run = ({ healthy = true, changes = '' } = {}) => {
    const post = 'service=festival-radar; app_root="$TEST_DIR/root"; release="$TEST_DIR/root/releases/' + sha + '"; commit="' + sha + '"; port=3100; ' + changes + '\n' + (healthy ? rearm.replaceAll('0:644', process.getuid() + ':644') : 'echo rollback-health-failed >&2; exit 1');
    return spawnSync('bash', ['-c', 'set -euo pipefail\n' + stub + '\n' + pre + '\n' + post], { env, encoding: 'utf8' });
  };
  return { dir, state, release, run };
}

// Both extraction points are on the same code path as the production installer.
test('armed DB timer rearmed only after exact SHA, closure and inactive legacy path', async () => {
  const h = await fixture();
  try {
    const result = h.run(); assert.equal(result.status, 0, result.stderr);
    const log = await readFile(path.join(h.dir, 'log'), 'utf8');
    assert.match(log, /enable --now festival-radar-db-due.timer/);
    assert.ok(log.indexOf('disable --now festival-radar-db-due.timer') < log.indexOf('enable --now festival-radar-db-due.timer'));
    assert.equal(await readFile(path.join(h.dir, 'due-enabled'), 'utf8'), 'enabled');
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('paused, fresh, legacy, and rollback paths never enable due timer', async () => {
  for (const options of [{ due: 'paused' }, { mode: 'legacy', due: 'paused', legacy: 'armed' }, { mode: null, due: 'missing', legacy: 'missing' }, { }]) {
    const h = await fixture(options);
    try {
      const result = h.run({ healthy: Object.keys(options).length !== 0 });
      if (Object.keys(options).length === 0) assert.notEqual(result.status, 0);
      else assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(await readFile(path.join(h.dir, 'log'), 'utf8').catch(() => ''), /enable --now festival-radar-db-due.timer/);
    } finally { await rm(h.dir, { recursive: true, force: true }); }
  }
  assert.ok(installer.indexOf('if [[ "$healthy" != true ]]') < installer.indexOf('if [[ "$db_due_timer_was_armed" == true ]]'));
  assert.match(installer, /flock -n 8/);
});

test('ambiguous snapshots refuse before timer inhibition', async () => {
  for (const options of [
    { mode: 'wrong' }, { mode: 'db-due', due: 'missing' }, { mode: 'db-due', legacy: 'armed' },
    { mode: 'db-due', legacyService: 'active' }, { mode: 'legacy', due: 'armed' },
  ]) {
    const h = await fixture(options);
    try {
      const result = h.run(); assert.notEqual(result.status, 0, JSON.stringify(options));
      assert.doesNotMatch(await readFile(path.join(h.dir, 'log'), 'utf8').catch(() => ''), /disable --now festival-radar-db-due.timer|enable --now festival-radar-db-due.timer/);
    } finally { await rm(h.dir, { recursive: true, force: true }); }
  }
});

test('post-health drift or partial enable refuses and never leaves timer armed', async () => {
  for (const options of [
    { healthSha: 'b'.repeat(40) }, { healthStatus: 'degraded' }, { probeSha: 'b'.repeat(40) }, { closure: 'false' }, { failEnable: true },
  ]) {
    const h = await fixture(options);
    try {
      const result = h.run(); assert.notEqual(result.status, 0, JSON.stringify(options));
      assert.equal(await readFile(path.join(h.dir, 'due-enabled'), 'utf8'), 'disabled');
    } finally { await rm(h.dir, { recursive: true, force: true }); }
  }
  const h = await fixture();
  try {
    const result = h.run({ changes: 'printf legacy > "$scheduler_state/mode"' });
    assert.notEqual(result.status, 0); assert.doesNotMatch(await readFile(path.join(h.dir, 'log'), 'utf8').catch(() => ''), /enable --now festival-radar-db-due.timer/);
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});
