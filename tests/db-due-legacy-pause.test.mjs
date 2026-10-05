import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateLegacyPause } from '../scripts/validate-db-due-legacy-pause.mjs';

const sha = 'a'.repeat(40);
const legacyTimer = 'festival-radar-collection-ingestion.timer';
const dueTimer = 'festival-radar-db-due.timer';
const legacy = 'festival-radar-collection@ingestion.service';
const due = 'festival-radar-db-due@tick.service';
const scheduler = 'festival-radar-db-due-scheduler.service';
const ingest = 'festival-radar-db-due@ingest.service';
const common = { LoadState: 'loaded', ActiveState: 'inactive', SubState: 'dead', Job: '', NeedDaemonReload: 'no' };
const timer = unit => ({ ...common, UnitFileState: 'disabled', Unit: unit, Persistent: unit === legacy ? 'yes' : 'no', UpheldBy: '' });
const service = trigger => ({ ...common, Type: 'oneshot', Restart: 'no', KillMode: 'control-group', RemainAfterExit: 'no', MainPID: '0', ControlPID: '0', ControlGroup: '',
  OnSuccess: '', OnFailure: '', UpheldBy: '', TriggeredBy: trigger, Triggers: '' });
const baseline = {
  [legacyTimer]: { ...timer(legacy), ActiveState: 'active', SubState: 'waiting', UnitFileState: 'enabled' }, [dueTimer]: timer(scheduler),
  [legacy]: { ...service(legacyTimer), ActiveState: 'failed', SubState: 'failed', Result: 'exit-code', ExecMainCode: '1', ExecMainStatus: '1', ExecMainStartTimestampMonotonic: '12345678', ExecMainExitTimestampMonotonic: '12345679' },
  [due]: service(''), [scheduler]: service(dueTimer), [ingest]: service(''),
};
const serialize = data => Object.entries(data).map(([key, value]) => key + '=' + value).join('\n') + '\n';

async function harness() {
  const dir = await mkdtemp(path.join(tmpdir(), 'legacy-recovery-'));
  const root = path.join(dir, 'root'); const state = path.join(dir, 'state');
  const bin = path.join(dir, 'bin'); const fixtures = path.join(dir, 'fixtures');
  const release = path.join(root, 'releases', sha); const lock = path.join(root, 'shared/ingestion/source-fetch.lock');
  const activation = path.join(dir, 'activation.lock');
  for (const folder of [release, state, bin, fixtures, path.dirname(lock)]) await mkdir(folder, { recursive: true, mode: 0o755 });
  await symlink(release, path.join(root, 'current'));
  await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
  await writeFile(path.join(state, 'mode'), 'legacy\n', { mode: 0o644 });
  await writeFile(path.join(state, 'last-tick'), '1 0 0\n', { mode: 0o644 });
  await writeFile(lock, '', { mode: 0o640 });
  await writeFile(path.join(bin, 'id'), '#!/bin/sh\necho "${TEST_UID:-0}"\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'systemctl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_DIR/calls"
# Every query and reset must execute while both locks remain held.
if flock -n "$TEST_FETCH_LOCK" true || flock -n "$TEST_ACTIVATION_LOCK" true; then exit 90; fi
case "$1" in
  show)
    [[ "$TEST_UNAVAILABLE" != "$4" ]] || { echo private-secret >&2; exit 1; }
    file="$TEST_DIR/fixtures/$4"
    if [[ -f "$TEST_DIR/stopped" && -f "$file.after" ]]; then file="$file.after"; fi
    cat "$file" ;;
  stop)
    [[ "$2" == festival-radar-collection-ingestion.timer && "$#" == 2 ]] || exit 91
    [[ "$TEST_STOP_FAIL" != 1 ]] || exit 1
    touch "$TEST_DIR/stopped" ;;
  disable)
    [[ "$2" == festival-radar-collection-ingestion.timer && "$#" == 2 ]] || exit 91
    [[ "$TEST_DISABLE_FAIL" != 1 ]] || exit 1
    touch "$TEST_DIR/disabled" ;;
  reset-failed)
    [[ "$2" == festival-radar-collection@ingestion.service && "$#" == 2 ]] || exit 91
    [[ "$TEST_RESET_FAIL" != 1 ]] || { echo private-reset-error >&2; exit 1; }
    touch "$TEST_DIR/stopped" ;;
  *) echo private-forbidden-action >&2; exit 92 ;;
esac
`, { mode: 0o755 });
  let script = await readFile('scripts/deploy/db-due-scheduler', 'utf8');
  script = script.replace('root=/opt/festival-radar', 'root=' + root)
    .replace('state=/var/lib/festival-radar-scheduler', 'state=' + state)
    .replace('/run/festival-radar-activation.lock', activation)
    .replaceAll('0:755', process.getuid() + ':755').replaceAll('0:644', process.getuid() + ':644')
    .replace('stat -c %U:%a "$lock"', 'stat -c %u:%a "$lock"').replace('www-data:640', process.getuid() + ':640');
  const wrapper = path.join(dir, 'scheduler'); await writeFile(wrapper, script, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_DIR: dir, TEST_FETCH_LOCK: lock,
    TEST_ACTIVATION_LOCK: activation, TEST_UNAVAILABLE: '', TEST_STOP_FAIL: '', TEST_DISABLE_FAIL: '', TEST_UID: '0' };
  const fixture = (unit, value, after = false) => writeFile(path.join(fixtures, unit + (after ? '.after' : '')), typeof value === 'string' ? value : serialize(value));
  const restore = async () => {
    await rm(path.join(dir, 'stopped'), { force: true }); await rm(path.join(dir, 'calls'), { force: true });
    for (const [unit, data] of Object.entries(baseline)) {
      await fixture(unit, data); await rm(path.join(fixtures, unit + '.after'), { force: true });
    }
    await fixture(legacyTimer, timer(legacy), true); await fixture(legacy, baseline[legacy], true);
  };
  await restore();
  const run = (extra = {}, args = [sha, 'pause-legacy-timer']) => spawnSync('bash', [wrapper, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  return { dir, root, state, release, lock, activation, wrapper, env, fixture, restore, run };
}

function assertMarker(output, status) {
  assert.equal(output.status, status === 'paused' ? 0 : 6, output.stderr);
  assert.equal(output.stderr, '');
  assert.equal(output.stdout, 'DB_DUE_LEGACY_PAUSE status=' + status + '\n');
  const result = validateLegacyPause(Buffer.from(output.stdout), sha, String(output.status));
  assert.equal(result.ok, status === 'paused');
}

test('pause changes only the legacy timer with both locks and leaves failed service and mode untouched', async () => {
  const h = await harness();
  try {
    assertMarker(h.run(), 'paused');
    const calls = (await readFile(path.join(h.dir, 'calls'), 'utf8')).trim().split('\n');
    assert.deepEqual(calls.filter(line => !line.startsWith('show ')), ['stop ' + legacyTimer, 'disable ' + legacyTimer]);
    assert.equal(calls.length, 14);
    assert.equal(await readFile(path.join(h.state, 'mode'), 'utf8'), 'legacy\n');
    assert.equal(await readFile(path.join(h.state, 'last-tick'), 'utf8'), '1 0 0\n');
    assertMarker(h.run(), 'refused');
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('pause refuses busy, unknown, unexpected and wrong-mode snapshots before stop', async () => {
  const h = await harness();
  try {
    const failures = [
      [legacyTimer, 'ActiveState', 'inactive'], [legacyTimer, 'UnitFileState', 'disabled'],
      [legacyTimer, 'Persistent', 'no'], [legacyTimer, 'Job', '42'],
      [legacy, 'ActiveState', 'active'], [legacy, 'Result', 'success'],
      [legacy, 'ExecMainStartTimestampMonotonic', '0'], [legacy, 'MainPID', '42'],
      [dueTimer, 'ActiveState', 'active'], [dueTimer, 'UnitFileState', 'enabled'],
      [scheduler, 'Job', '123'], [ingest, 'ControlGroup', '/unexpected'],
    ];
    for (const [unit, field, value] of failures) {
      await h.restore(); await h.fixture(unit, { ...baseline[unit], [field]: value });
      assertMarker(h.run(), 'refused');
      const calls = await readFile(path.join(h.dir, 'calls'), 'utf8');
      assert.doesNotMatch(calls, /^(stop|disable|reset-failed|start|enable) /m);
    }
    for (const unit of [legacyTimer, legacy, dueTimer, due, scheduler, ingest]) {
      await h.restore(); assertMarker(h.run({ TEST_UNAVAILABLE: unit }), 'refused');
      await h.restore(); await h.fixture(unit, serialize(baseline[unit]) + 'Unknown=private\n'); assertMarker(h.run(), 'refused');
      await h.restore(); await h.fixture(unit, serialize(baseline[unit]) + 'Job=42\n'); assertMarker(h.run(), 'refused');
    }
    await h.restore(); await writeFile(path.join(h.state, 'mode'), 'db-due\n'); assertMarker(h.run(), 'refused');
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('partial failures and changed invocation fingerprint never claim a verified pause', async () => {
  const h = await harness();
  try {
    assertMarker(h.run({ TEST_STOP_FAIL: '1' }), 'stop-error');
    await h.restore(); assertMarker(h.run({ TEST_DISABLE_FAIL: '1' }), 'disable-error');
    for (const [unit, data] of [
      [legacyTimer, { ...timer(legacy), ActiveState: 'active', SubState: 'waiting' }],
      [legacy, { ...baseline[legacy], ExecMainStartTimestampMonotonic: '12345680' }],
      [dueTimer, { ...baseline[dueTimer], ActiveState: 'active' }],
    ]) {
      await h.restore(); await h.fixture(unit, data, true); assertMarker(h.run(), 'postcheck-error');
    }
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('exact SHA, uid and locks gate before mutation; relay accepts only fixed marker and exit status', async () => {
  const h = await harness();
  try {
    assert.equal(h.run({ TEST_UID: '1000' }).status, 2);
    assert.equal(h.run({}, ['bad', 'pause-legacy-timer']).status, 2);
    await writeFile(path.join(h.release, 'DEPLOYED_COMMIT'), 'b'.repeat(40)); assert.equal(h.run().status, 4);
    await writeFile(path.join(h.release, 'DEPLOYED_COMMIT'), sha);
    for (const lock of [h.lock, h.activation]) {
      const held = spawnSync('bash', ['-c', 'exec 7<"$1"; flock -n 7; bash "$2" "$3" pause-legacy-timer', 'bash', lock, h.wrapper, sha], { encoding: 'utf8', env: h.env });
      assert.equal(held.status, 5); assert.equal(held.stdout, '');
    }
    await assert.rejects(readFile(path.join(h.dir, 'calls')), { code: 'ENOENT' });
    const original = await readFile('scripts/deploy/activate-release', 'utf8');
    const dispatcher = path.join(h.dir, 'activate-release');
    await writeFile(dispatcher, original.replace('/run/festival-radar-activation.lock', h.activation)
      .replaceAll('/usr/local/libexec/festival-radar/db-due-scheduler', h.wrapper));
    const invoke = (caller) => spawnSync('bash', [dispatcher, sha, 'due-pause-legacy-timer'], { encoding: 'utf8', env: { ...h.env, SUDO_USER: caller } });
    assert.equal(invoke('other').status, 3);
    assertMarker(invoke('festival-radar-deploy'), 'paused');
    for (const status of ['paused', 'refused', 'stop-error', 'disable-error', 'postcheck-error']) {
      const marker = 'DB_DUE_LEGACY_PAUSE status=' + status + '\n';
      const exit = status === 'paused' ? '0' : '6';
      assert.equal(validateLegacyPause(Buffer.from(marker), sha, exit).marker, marker);
      for (const input of [marker + marker, marker + '\n', 'secret\n' + marker, marker.trimEnd(), 'x'.repeat(129)]) {
        assert.throws(() => validateLegacyPause(Buffer.from(input), sha, exit), /rejected/);
      }
      assert.throws(() => validateLegacyPause(Buffer.from(marker), sha, exit === '0' ? '6' : '0'), /rejected/);
    }
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('deployment preserves paused timer without rearming or clearing failed service', async () => {
  const h = await harness();
  try {
    const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
    const start = installer.indexOf('scheduler_state=/var/lib/festival-radar-scheduler');
    const end = installer.indexOf('install -m 0600 "$env_source"', start);
    const init = installer.slice(start, end)
      .replace('scheduler_state=/var/lib/festival-radar-scheduler', 'scheduler_state="$1/state"')
      .replaceAll('0:755', process.getuid() + ':755').replaceAll('0:644', process.getuid() + ':644')
      .replace('/etc/systemd/system/festival-radar-collection-ingestion.timer', '"$1/legacy.timer"')
      .replace('/etc/systemd/system/festival-radar-db-due.timer', '"$1/absent-due.timer"');
    const branch = installer.slice(installer.indexOf('if [[ "$scheduler_mode" == legacy && "$legacy_timer_was_armed" == true ]]; then'), installer.indexOf('systemctl restart "$service"'));
    await writeFile(path.join(h.dir, 'legacy.timer'), '[Timer]\n');
    for (const [enabled, active, expected] of [['disabled', 'inactive', 0], ['enabled', 'active', 0], ['enabled', 'inactive', 6]]) {
      const script = 'set -euo pipefail; systemctl() { if [[ "$1" == is-enabled ]]; then echo "$T_ENABLED"; elif [[ "$1" == is-active ]]; then echo "$T_ACTIVE"; else printf "%s\\n" "$*"; fi; }; ' + init + '\nservice=festival-radar\n' + branch;
      const result = spawnSync('bash', ['-c', script, 'bash', h.dir], { encoding: 'utf8', env: { ...process.env, T_ENABLED: enabled, T_ACTIVE: active } });
      assert.equal(result.status, expected, result.stderr);
      assert.equal(result.stdout.includes('enable --now festival-radar-collection-ingestion.timer'), enabled === 'enabled' && active === 'active');
      if (enabled === 'disabled') assert.doesNotMatch(result.stdout, /stop festival-radar-collection@ingestion.service/);
    }
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('pause workflow remains manual-only, protected, and relays no raw output', async () => {
  const workflow = await readFile('.github/workflows/db-due-legacy-pause.yml', 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: festival-radar-production/);
  assert.match(workflow, /activate-release "\$GITHUB_SHA" due-pause-legacy-timer > "\$audit" 2>\/dev\/null/);
  assert.match(workflow, /node scripts\/validate-db-due-legacy-pause.mjs/);
  assert.doesNotMatch(workflow, /schedule:|due-switch|due-ingest|set -x|cat "\$audit"/);
});
