import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateLegacyRecovery } from '../scripts/validate-db-due-legacy-recovery.mjs';

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
  [legacyTimer]: timer(legacy), [dueTimer]: timer(scheduler),
  [legacy]: { ...service(legacyTimer), ActiveState: 'failed', SubState: 'failed', Result: 'exit-code', ExecMainCode: '1', ExecMainStatus: '1' },
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
    if [[ -f "$TEST_DIR/reset" && -f "$file.after" ]]; then file="$file.after"; fi
    cat "$file" ;;
  reset-failed)
    [[ "$2" == festival-radar-collection@ingestion.service && "$#" == 2 ]] || exit 91
    [[ "$TEST_RESET_FAIL" != 1 ]] || { echo private-reset-error >&2; exit 1; }
    touch "$TEST_DIR/reset" ;;
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
    TEST_ACTIVATION_LOCK: activation, TEST_UNAVAILABLE: '', TEST_RESET_FAIL: '', TEST_UID: '0' };
  const fixture = (unit, value, after = false) => writeFile(path.join(fixtures, unit + (after ? '.after' : '')), typeof value === 'string' ? value : serialize(value));
  const restore = async () => {
    await rm(path.join(dir, 'reset'), { force: true }); await rm(path.join(dir, 'calls'), { force: true });
    for (const [unit, data] of Object.entries(baseline)) {
      await fixture(unit, data); await rm(path.join(fixtures, unit + '.after'), { force: true });
    }
    await fixture(legacy, { ...baseline[legacy], ActiveState: 'inactive', SubState: 'dead', Result: 'success' }, true);
  };
  await restore();
  const run = (extra = {}, args = [sha, 'reset-legacy-failed']) => spawnSync('bash', [wrapper, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  return { dir, root, state, release, lock, activation, wrapper, env, fixture, restore, run };
}

function assertMarker(output, status) {
  assert.equal(output.status, status === 'reset' ? 0 : 6, output.stderr);
  assert.equal(output.stderr, '');
  assert.equal(output.stdout, `DB_DUE_LEGACY_RECOVERY status=${status}\n`);
  const result = validateLegacyRecovery(Buffer.from(output.stdout), sha, String(output.status));
  assert.equal(result.ok, status === 'reset');
}

test('explicit recovery resets only the paused failed legacy oneshot, under both locks, without rearming or ingestion', async () => {
  const h = await harness();
  try {
    for (const cleared of [false, true]) {
      await h.restore();
      if (cleared) await h.fixture(legacy, { ...baseline[legacy], ActiveState: 'inactive', SubState: 'dead', Result: 'success', ExecMainCode: '0', ExecMainStatus: '0' }, true);
      assertMarker(h.run(), 'reset');
      const calls = (await readFile(path.join(h.dir, 'calls'), 'utf8')).trim().split('\n');
      assert.equal(calls.filter(line => line === 'reset-failed ' + legacy).length, 1);
      assert.equal(calls.length, 13); // six snapshots before, one reset, six after
      assert.ok(calls.every(line => line.startsWith('show --all --property=') || line === 'reset-failed ' + legacy));
      assert.equal(await readFile(path.join(h.state, 'mode'), 'utf8'), 'legacy\n');
      assert.equal(await readFile(path.join(h.state, 'last-tick'), 'utf8'), '1 0 0\n');
      assertMarker(h.run(), 'refused'); // non-idempotent: already inactive never reset again
    }
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('recovery refuses enabled/active timers, jobs, processes, automatic triggers and malformed or unavailable snapshots', async () => {
  const h = await harness();
  try {
    const failures = [
      [legacyTimer, 'UnitFileState', 'enabled'], [legacyTimer, 'ActiveState', 'active'], [legacyTimer, 'Persistent', 'no'],
      [dueTimer, 'UnitFileState', 'enabled'], [dueTimer, 'ActiveState', 'active'],
      [legacyTimer, 'Unit', due], [dueTimer, 'Unit', legacy],
      [legacy, 'ActiveState', 'active'], [legacy, 'ActiveState', 'inactive'],
      [legacy, 'Result', 'success'], [legacy, 'Result', 'signal'],
      [legacy, 'ExecMainCode', '2'], [legacy, 'ExecMainStatus', '2'],
      [legacy, 'ExecMainStatus', '01'], [legacy, 'ExecMainStatus', 'private'],
    ];
    for (const unit of Object.keys(baseline)) {
      for (const [key, value] of [['LoadState', 'not-found'], ['Job', '42'], ['Job', '0'], ['NeedDaemonReload', 'yes'], ['UpheldBy', 'unexpected.service']]) failures.push([unit, key, value]);
      if (!unit.endsWith('.timer')) {
        for (const [key, value] of [['MainPID', '42'], ['ControlPID', '42'], ['ControlGroup', '/system.slice/unexpected.service'], ['Restart', 'on-failure'], ['KillMode', 'process'], ['RemainAfterExit', 'yes'], ['Type', 'simple'], ['OnSuccess', 'unexpected.service'], ['OnFailure', 'unexpected.service'], ['Triggers', 'unexpected.service'], ['TriggeredBy', 'unexpected.timer']]) failures.push([unit, key, value]);
      }
    }
    for (const [unit, key, value] of failures) {
      await h.restore(); await h.fixture(unit, { ...baseline[unit], [key]: value });
      assertMarker(h.run(), 'refused');
      await assert.rejects(readFile(path.join(h.dir, 'reset')), { code: 'ENOENT' });
    }
    // Every missing or duplicate property, unknown text and binary data fails closed.
    for (const unit of Object.keys(baseline)) {
      for (const key of Object.keys(baseline[unit])) {
        await h.restore(); const incomplete = { ...baseline[unit] }; delete incomplete[key];
        await h.fixture(unit, incomplete); assertMarker(h.run(), 'refused');
        await h.fixture(unit, serialize(baseline[unit]) + key + '=' + baseline[unit][key] + '\n');
        assertMarker(h.run(), 'refused');
      }
      for (const raw of ['Private=secret\n', 'private text\n', '\0', 'x'.repeat(1025)]) {
        await h.restore(); await h.fixture(unit, serialize(baseline[unit]) + raw); assertMarker(h.run(), 'refused');
      }
      await h.restore(); assertMarker(h.run({ TEST_UNAVAILABLE: unit }), 'refused');
    }
    await h.restore(); await writeFile(path.join(h.state, 'mode'), 'db-due\n'); assertMarker(h.run(), 'refused');
    await writeFile(path.join(h.state, 'mode'), 'private-invalid\n'); assertMarker(h.run(), 'refused');
    await rm(path.join(h.state, 'mode')); assertMarker(h.run(), 'refused');
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('failed reset or post-verification never starts, rearms, retries or changes mode', async () => {
  const h = await harness();
  try {
    assertMarker(h.run({ TEST_RESET_FAIL: '1' }), 'reset-error');
    for (const [unit, data] of [[legacy, baseline[legacy]], [legacyTimer, { ...baseline[legacyTimer], ActiveState: 'active' }], [dueTimer, { ...baseline[dueTimer], UnitFileState: 'enabled' }]]) {
      await h.restore(); await h.fixture(unit, data, true);
      assertMarker(h.run(), 'postcheck-error');
      const calls = await readFile(path.join(h.dir, 'calls'), 'utf8');
      assert.equal(calls.split('\n').filter(line => line.startsWith('reset-failed ')).length, 1);
      assert.doesNotMatch(calls, /start |stop |enable |disable /);
    }
    assert.equal(await readFile(path.join(h.state, 'mode'), 'utf8'), 'legacy\n');
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('recovery exact SHA, root, argument and lock gates reject before any systemd reset', async () => {
  const h = await harness();
  try {
    assert.equal(h.run({ TEST_UID: '1000' }).status, 2);
    assert.equal(h.run({}, ['bad', 'reset-legacy-failed']).status, 2);
    assert.equal(h.run({}, [sha, 'reset-legacy-failed', 'extra']).status, 2);
    await writeFile(path.join(h.release, 'DEPLOYED_COMMIT'), 'b'.repeat(40)); assert.equal(h.run().status, 4);
    await writeFile(path.join(h.release, 'DEPLOYED_COMMIT'), sha);
    assert.equal(h.run({}, ['b'.repeat(40), 'reset-legacy-failed']).status, 4);
    for (const lock of [h.lock, h.activation]) {
      const held = spawnSync('bash', ['-c', 'exec 7<"$1"; flock -n 7; bash "$2" "$3" reset-legacy-failed', 'bash', lock, h.wrapper, sha], { encoding: 'utf8', env: h.env });
      assert.equal(held.status, 5); assert.equal(held.stdout, '');
    }
    await assert.rejects(readFile(path.join(h.dir, 'calls')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(h.dir, 'reset')), { code: 'ENOENT' });
    const original = await readFile('scripts/deploy/activate-release', 'utf8');
    const dispatcher = path.join(h.dir, 'activate-release');
    await writeFile(dispatcher, original.replace('/run/festival-radar-activation.lock', h.activation)
      .replaceAll('/usr/local/libexec/festival-radar/db-due-scheduler', h.wrapper));
    const invoke = (args, caller) => spawnSync('bash', [dispatcher, ...args], { encoding: 'utf8', env: { ...h.env, SUDO_USER: caller } });
    assert.equal(invoke([sha, 'due-reset-legacy-failed'], 'other').status, 3);
    assert.equal(invoke([sha, 'due-reset-legacy-failed', 'extra'], 'festival-radar-deploy').status, 2);
    assertMarker(invoke([sha, 'due-reset-legacy-failed'], 'festival-radar-deploy'), 'reset');
  } finally { await rm(h.dir, { recursive: true, force: true }); }
});

test('recovery relay validates one bounded enum-only marker and matching remote exit before output', async () => {
  for (const status of ['reset', 'refused', 'reset-error', 'postcheck-error']) {
    const marker = `DB_DUE_LEGACY_RECOVERY status=${status}\n`; const exit = status === 'reset' ? '0' : '6';
    assert.equal(validateLegacyRecovery(Buffer.from(marker), sha, exit).marker, marker);
    for (const input of [marker + marker, marker + '\n', 'private\n' + marker, marker + 'private', marker.trimEnd(), marker.replace(status, 'private'), 'x'.repeat(129)]) {
      assert.throws(() => validateLegacyRecovery(Buffer.from(input), sha, exit), /rejected/);
    }
    assert.throws(() => validateLegacyRecovery(Buffer.from(marker), sha, exit === '0' ? '6' : '0'), /rejected/);
    assert.throws(() => validateLegacyRecovery(Buffer.from(marker), sha, '255'), /rejected/);
  }
  const workflow = await readFile('.github/workflows/db-due-legacy-recovery.yml', 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/); assert.match(workflow, /group: festival-radar-production/);
  assert.match(workflow, /ulimit -f 4; timeout --signal=TERM --kill-after=5s 30s ssh/);
  assert.match(workflow, /activate-release "\$GITHUB_SHA" due-reset-legacy-failed > "\$audit" 2>\/dev\/null\) 2>\/dev\/null/);
  assert.match(workflow, /node scripts\/validate-db-due-legacy-recovery.mjs "\$GITHUB_SHA" "\$result" < "\$audit"/);
  assert.doesNotMatch(workflow, /schedule:|due-ingest|due-switch|preflight-ssh|set -x|cat "\$audit"/);
});
