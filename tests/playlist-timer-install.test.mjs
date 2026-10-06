import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, symlink, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPlaylistInstallMode } from '../scripts/deploy/read-playlist-install-mode.ts';

const receipt = { version: 1, mode: 'database', reconciled: true, legacyDrained: true,
  commit: 'a'.repeat(40), queueHash: 'b'.repeat(64) };
const legacy = 'festival-radar-collection-playlists.timer';
const database = 'festival-radar-collection-playlists-db.timer';
const due = 'festival-radar-db-due.timer';

test('installer proof reader distinguishes absent rows from corrupt receipts and reads only OperationalState', async () => {
  const read = rows => readPlaylistInstallMode({ $queryRaw: async (sql, ...values) => {
    assert.equal(sql.join(''), 'SELECT payload FROM "OperationalState" WHERE key = \'playlist-cutover\'');
    assert.deepEqual(values, []);
    return rows;
  } });
  assert.equal(await read([]), 'absent');
  assert.equal(await read([{ payload: receipt }]), 'database');
  for (const payload of [null, {}, 'database', [], { ...receipt, reconciled: false },
    { ...receipt, legacyDrained: false }, { ...receipt, version: 2 },
    { ...receipt, commit: 'bad' }, { ...receipt, queueHash: 'bad' },
    { ...receipt, commit: [receipt.commit] }]) {
    await assert.rejects(read([{ payload }]));
  }
  await assert.rejects(read([{ payload: receipt }, { payload: receipt }]));
  await assert.rejects(readPlaylistInstallMode({ $queryRaw: async () => { throw new Error('private'); } }));
});

// Run the entire installer in a temporary filesystem, using the real packaged
// proof CLI with a synthetic Prisma client. No host systemd or DB is contacted.
async function fixture(t, { rows = [{ payload: receipt }], states = {}, proofError = false,
  fail = '', unhealthy = false, previous = false, proofFlip = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'playlist-install-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mapped = value => value.replaceAll('/opt/festival-radar', dir + '/app')
    .replaceAll('/etc/systemd/system', dir + '/units')
    .replaceAll('/var/lib/festival-radar-scheduler', dir + '/scheduler')
    .replaceAll('/usr/local/libexec/festival-radar', dir + '/libexec')
    .replaceAll('/var/www/vhosts/system', dir + '/vhosts')
    .replaceAll('/run/festival-radar', dir + '/run/festival-radar');
  const stage = dir + '/stage/app';
  for (const folder of ['scripts/deploy', 'lib/catalog', '.runtime/npm/bin', 'node_modules/@prisma/client'])
    await mkdir(stage + '/' + folder, { recursive: true });
  for (const folder of ['bin', 'units', 'run', 'scheduler', 'libexec', 'app/shared/ingestion'])
    await mkdir(dir + '/' + folder, { recursive: true, mode: 0o755 });
  await writeFile(dir + '/scheduler/mode', 'db-due\n', { mode: 0o644 });
  await writeFile(dir + '/scheduler/last-tick', 'old heartbeat');
  await writeFile(dir + '/app/shared/ingestion/source-fetch.lock', '', { mode: 0o640 });
  await writeFile(dir + '/units/' + due, 'old due unit');
  await writeFile(dir + '/units/festival-radar-collection-ingestion.timer', 'old legacy ingestion timer');
  const sha = 'c'.repeat(40); // The activation SHA intentionally differs.
  const oldRelease = dir + '/app/releases/' + 'e'.repeat(40);
  if (previous) {
    await mkdir(oldRelease, { recursive: true });
    await symlink(oldRelease, dir + '/app/current');
  }
  await writeFile(stage + '/DEPLOYED_COMMIT', sha);
  await writeFile(stage + '/package.json', '{"type":"module"}');
  await writeFile(stage + '/.runtime/npm/bin/npm-cli.js', 'fixture');
  await writeFile(stage + '/.runtime/node', `#!/bin/bash
printf 'runtime %s\\n' "$*" >> "$FIXTURE/log"
if [[ "$1" == --experimental-strip-types ]]; then exec "$NODE_BIN" "$@"; fi
exit 0
`, { mode: 0o755 });
  await cp('lib/catalog/playlist-cutover.ts', stage + '/lib/catalog/playlist-cutover.ts');
  const scripts = ['read-playlist-install-mode.ts', 'playlist-timer-install.sh', 'db-due-assets.sh',
    'db-due-scheduler-assets.sh'];
  for (const script of scripts) await writeFile(stage + '/scripts/deploy/' + script,
    mapped(await readFile('scripts/deploy/' + script, 'utf8')));
  for (const script of ['start-db-due', 'db-due-scheduler', 'check-db-due-tick-ready', 'reconfigure-webserver.sh'])
    await writeFile(stage + '/scripts/deploy/' + script, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  await writeFile(stage + '/node_modules/@prisma/client/package.json', '{"type":"module","exports":"./index.js"}');
  await writeFile(stage + '/node_modules/@prisma/client/index.js', `
import { existsSync } from 'node:fs';
export class PrismaClient {
  async $queryRaw(sql) {
    if (sql.join('') !== ${JSON.stringify('SELECT payload FROM "OperationalState" WHERE key = \'playlist-cutover\'')}) throw new Error('unexpected query');
    if (process.env.PROOF_ERROR === '1') throw new Error('private database error');
    if (process.env.PROOF_FLIP === '1' && existsSync(process.env.FIXTURE + '/health-seen')) return [];
    return JSON.parse(process.env.PROOF_ROWS);
  }
  async $disconnect() {}
}
`);
  // Stub privileged owner changes; keep real modes, archive extraction, flock,
  // symlinks, and installer rollback/health logic.
  await writeFile(dir + '/bin/install', `#!/bin/bash
args=()
while (( $# )); do
  case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
done
exec /usr/bin/install "\${args[@]}"
`, { mode: 0o755 });
  await writeFile(dir + '/bin/chown', '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  await writeFile(dir + '/bin/curl', `#!/bin/bash
echo health >> "$FIXTURE/log"
touch "$FIXTURE/health-seen"
printf '{"commit":"%s","database":"ok","catalog":"database"}' "$HEALTH_SHA"
`, { mode: 0o755 });
  await writeFile(dir + '/bin/sleep', '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  await writeFile(dir + '/bin/systemctl', `#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE/log"
unit="\${@: -1}"
case "$1" in
  is-enabled|is-active)
    if [[ ! -f "$FIXTURE/state-$unit" ]]; then
      if [[ "$1" == is-enabled ]]; then echo not-found; else echo inactive; fi
      exit 1
    fi
    read -r enabled active < "$FIXTURE/state-$unit"
    if [[ "$1" == is-enabled ]]; then echo "$enabled"; else echo "$active"; fi
    ;;
  disable|enable)
    if [[ "$*" == "$FAIL_CALL" ]]; then exit 1; fi
    if [[ "$1" == disable ]]; then echo 'disabled inactive'; else echo 'enabled active'; fi > "$FIXTURE/state-$unit"
    ;;
esac
`, { mode: 0o755 });
  const initial = { [legacy]: 'enabled active', [database]: 'enabled active',
    [due]: 'disabled inactive', 'festival-radar-collection-ingestion.timer': 'disabled inactive', ...states };
  for (const [unit, state] of Object.entries(initial)) {
    if (state !== null) await writeFile(dir + '/state-' + unit, state);
  }
  let installer = mapped(await readFile('scripts/deploy/install-release.sh', 'utf8'));
  installer = installer.replaceAll('stat -c %U:%a', 'stat -c %u:%a')
    .replaceAll('www-data:640', process.getuid() + ':640')
    .replaceAll('0:755', process.getuid() + ':755').replaceAll('0:644', process.getuid() + ':644');
  await writeFile(dir + '/installer', installer);
  const archive = dir + '/release.tar.gz';
  const packed = spawnSync('tar', ['-czf', archive, '-C', dir + '/stage', 'app'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  await writeFile(dir + '/env', 'DATABASE_URL=synthetic-unused\n');
  const runInstaller = () => spawnSync('bash', [dir + '/installer', archive, sha, dir + '/env'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: dir + '/bin:' + process.env.PATH,
      NODE_BIN: process.execPath, FIXTURE: dir, APP_ROOT: dir + '/app',
      PROOF_ROWS: JSON.stringify(rows), PROOF_ERROR: proofError ? '1' : '', PROOF_FLIP: proofFlip ? '1' : '',
      HEALTH_SHA: unhealthy ? 'd'.repeat(40) : sha, FAIL_CALL: fail },
  });
  const result = runInstaller();
  const redeploy = async () => {
    const packed = spawnSync('tar', ['-czf', archive, '-C', dir + '/stage', 'app'], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    await writeFile(dir + '/env', 'DATABASE_URL=synthetic-unused\n');
    return runInstaller();
  };
  const log = await readFile(dir + '/log', 'utf8').catch(() => { throw new Error('Installer exited early: ' + result.status + ' ' + result.stderr); });
  const state = unit => readFile(dir + '/state-' + unit, 'utf8').then(s => s.trim());
  return { result, log, state, dir, redeploy, oldRelease };
}

test('completed durable cutover repairs dual timers, survives later SHA, and leaves DB-due paused', async t => {
  const h = await fixture(t);
  assert.equal(h.result.status, 0, h.result.stderr);
  assert.equal(await h.state(legacy), 'disabled inactive');
  assert.equal(await h.state(database), 'enabled active');
  assert.equal(await h.state(due), 'disabled inactive');
  assert.ok(h.log.indexOf('disable --now ' + legacy) < h.log.indexOf('enable --now ' + database));
  assert.ok(h.log.indexOf('migrate deploy') < h.log.indexOf('read-playlist-install-mode.ts'));
  assert.ok(h.log.indexOf('health') < h.log.indexOf('enable --now ' + database));
  assert.doesNotMatch(h.log, /enable --now festival-radar-db-due.timer|enable --now festival-radar-collection-ingestion.timer/);
  assert.doesNotMatch(h.log, /stop festival-radar-collection@playlists/);
  assert.equal(await readFile(h.dir + '/scheduler/mode', 'utf8'), 'db-due\n');
  await assert.rejects(readFile(h.dir + '/scheduler/last-tick'), { code: 'ENOENT' });
  const second = await h.redeploy();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await h.state(legacy), 'disabled inactive');
  assert.equal(await h.state(database), 'enabled active');
  assert.equal(await h.state(due), 'disabled inactive');
});

test('valid DB receipt restores the single DB timer even when both playlist timers were paused', async t => {
  const h = await fixture(t, { states: { [legacy]: 'disabled inactive', [database]: 'disabled inactive' } });
  assert.equal(h.result.status, 0, h.result.stderr);
  assert.equal(await h.state(legacy), 'disabled inactive');
  assert.equal(await h.state(database), 'enabled active');
});

test('verified absence keeps pre-cutover cadence and fresh installations legacy-only', async t => {
  for (const states of [{ [database]: 'disabled inactive' }, { [legacy]: null, [database]: null }]) {
    const h = await fixture(t, { rows: [], states });
    assert.equal(h.result.status, 0, h.result.stderr);
    assert.equal(await h.state(legacy), 'enabled active');
    assert.equal(await h.state(database), 'disabled inactive');
    assert.doesNotMatch(h.log, new RegExp('enable --now ' + database));
  }
});

test('missing, corrupt, or unavailable proof refuses deployment without fallback or dual activation', async t => {
  const cases = [{ rows: [] }, { rows: [], states: { [legacy]: 'disabled inactive', [database]: 'disabled inactive' } },
    { rows: [], states: { [legacy]: null, [database]: 'disabled inactive' } },
    { rows: [], states: { [database]: 'masked inactive' } },
    { rows: [], states: { [database]: 'disabled active' } },
    { rows: [], states: { [legacy]: 'enabled inactive', [database]: 'disabled inactive' } },
    { rows: [], states: { [database]: 'query-error unknown' } },
    { rows: [{ payload: null }] }, { rows: [{ payload: { ...receipt, legacyDrained: false } }] },
    { proofError: true }];
  for (const input of cases) {
    const h = await fixture(t, input);
    assert.equal(h.result.status, 6, h.result.stderr);
    assert.equal(await h.state(legacy), 'disabled inactive');
    assert.equal(await h.state(database), 'disabled inactive');
    assert.doesNotMatch(h.log, /enable --now/);
    assert.doesNotMatch(h.result.stdout + h.result.stderr, /private database error|synthetic-unused/);
    assert.match(h.result.stderr, /playlist cutover proof/);
  }
});

test('cutover proof disappearing during health check inhibits both paths', async t => {
  const h = await fixture(t, { proofFlip: true });
  assert.equal(h.result.status, 6, h.result.stderr);
  assert.equal(await h.state(legacy), 'disabled inactive');
  assert.equal(await h.state(database), 'disabled inactive');
  assert.match(h.result.stderr, /proof changed or unavailable/);
  assert.doesNotMatch(h.log, new RegExp('enable --now ' + legacy));
});

test('missing unit reported active cannot bypass inhibition on DB cutover', async t => {
  const h = await fixture(t, { states: { [legacy]: 'not-found active', [database]: 'enabled active' } });
  assert.equal(h.result.status, 6, h.result.stderr);
  assert.equal(await h.state(legacy), 'disabled inactive');
  assert.equal(await h.state(database), 'disabled inactive');
  assert.doesNotMatch(h.log, new RegExp('enable --now ' + database));
});

test('timer operation failures inhibit both paths and never re-enable legacy', async t => {
  for (const fail of ['disable --now ' + legacy, 'enable --now ' + database]) {
    const h = await fixture(t, { fail });
    assert.equal(h.result.status, 6, h.result.stderr);
    assert.equal(await h.state(database), 'disabled inactive');
    assert.doesNotMatch(h.log, new RegExp('enable --now ' + legacy));
    if (fail.startsWith('disable')) assert.doesNotMatch(h.log, new RegExp('enable --now ' + database));
    else assert.equal(await h.state(legacy), 'disabled inactive');
    if (fail.startsWith('disable')) assert.match(h.result.stderr, /inhibition incomplete/);
  }
});

test('failed release health never rearms a paused DB playlist timer or reverts to legacy', async t => {
  const h = await fixture(t, { unhealthy: true, previous: true, states: { [database]: 'disabled inactive' } });
  assert.equal(h.result.status, 1, h.result.stderr);
  assert.equal(await readlink(h.dir + '/app/current'), h.oldRelease);
  assert.equal(await h.state(legacy), 'disabled inactive');
  assert.equal(await h.state(database), 'disabled inactive');
  assert.doesNotMatch(h.log, /enable --now festival-radar-collection-playlists/);
});
