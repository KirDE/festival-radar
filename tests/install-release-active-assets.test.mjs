import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, chmod, readFile, readlink, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sha = 'a'.repeat(40), oldSha = 'b'.repeat(40);
const timer = 'festival-radar-db-due.timer';
const scheduler = 'festival-radar-db-due-scheduler.service';
const tick = 'festival-radar-db-due@tick.service';
const assets = ['system/festival-radar-db-due@.service', 'system/' + scheduler,
  'system/' + timer, 'libexec/start-db-due', 'libexec/db-due-scheduler', 'libexec/check-db-due-tick-ready'];

// Run the whole installer, including real archive extraction, asset snapshots,
// symlink transitions and EXIT trap. All privileged paths are mapped into /tmp;
// systemctl, runtime/migrations, HTTP and ownership commands are local stubs.
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'install-active-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = dir + '/app', oldRelease = root + '/releases/' + oldSha;
  const release = root + '/releases/' + sha, stage = dir + '/stage/app';
  const mapped = text => text.replaceAll('/opt/festival-radar', root)
    .replaceAll('/etc/systemd/system', dir + '/system')
    .replaceAll('/usr/local/libexec/festival-radar', dir + '/libexec')
    .replaceAll('/var/lib/festival-radar-scheduler', dir + '/scheduler')
    .replaceAll('/var/www/vhosts/system', dir + '/vhosts')
    .replaceAll('/run/festival-radar', dir + '/run/festival-radar')
    .replaceAll('stat -c %U:%a', 'stat -c %u:%a')
    .replaceAll('www-data:640', process.getuid() + ':640')
    .replaceAll('0:755', process.getuid() + ':755').replaceAll('0:644', process.getuid() + ':644');
  for (const p of [oldRelease, root + '/shared', stage + '/scripts/deploy', stage + '/.runtime/npm/bin',
    dir + '/system', dir + '/libexec', dir + '/scheduler', dir + '/run', dir + '/bin'])
    await mkdir(p, { recursive: true });
  await chmod(dir + '/scheduler', 0o755);
  if (!options.fresh) {
    await writeFile(oldRelease + '/DEPLOYED_COMMIT', options.oldStamp || oldSha);
    await symlink(oldRelease, root + '/current');
  }
  await writeFile(root + '/shared/production.env', 'PRIOR_ENV=true\n');
  await writeFile(dir + '/scheduler/mode', 'db-due\n', { mode: 0o644 });
  const prior = new Map();
  for (const asset of assets) {
    const value = `prior ${asset} ${oldSha}\n`;
    prior.set(asset, value);
    await writeFile(dir + '/' + asset, value);
  }
  await writeFile(dir + '/system/festival-radar-collection-ingestion.timer', 'legacy timer');
  await writeFile(stage + '/DEPLOYED_COMMIT', sha);
  await writeFile(stage + '/.runtime/npm/bin/npm-cli.js', '// unused');
  await writeFile(stage + '/.runtime/node', '#!/bin/bash\nif [[ "$1" == -e ]]; then exec "$NODE_BIN" "$@"; fi\nexit 0\n', { mode: 0o755 });
  for (const name of ['db-due-assets.sh', 'db-due-scheduler-assets.sh', 'start-db-due', 'db-due-scheduler', 'check-db-due-tick-ready'])
    await writeFile(stage + '/scripts/deploy/' + name, mapped(await readFile('scripts/deploy/' + name, 'utf8')), { mode: 0o755 });
  await writeFile(stage + '/scripts/deploy/playlist-timer-install.sh',
    'playlist_install_select_mode() { :; }; playlist_install_quiesce_other() { :; }; playlist_install_apply_mode() { :; }\n');
  await writeFile(stage + '/scripts/deploy/reconfigure-webserver.sh', '#!/bin/bash\nexit 0\n');
  const stubs = {
    install: `#!/bin/bash
args=()
while (( $# )); do case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done
exec /usr/bin/install "\${args[@]}"
`,
    chown: '#!/bin/bash\n[[ "$FAIL_CHOWN" != true ]]\n',
    sleep: '#!/bin/bash\nexit 0\n',
    ln: `#!/bin/bash
if [[ "$2" == "$NEW_RELEASE" && "$ACTIVATION" == before ]]; then exit 9; fi
if [[ "$2" == "$NEW_RELEASE" && "$ACTIVATION" == before-stamp ]]; then
  /usr/bin/rm "$OLD_RELEASE/DEPLOYED_COMMIT"; exit 9
fi
if [[ "$2" == "$OLD_RELEASE" && "$ROLLBACK_FAIL" == true ]]; then exit 9; fi
/usr/bin/ln "$@" || exit
if [[ "$2" == "$NEW_RELEASE" ]]; then
  case "$ACTIVATION" in after) exit 9 ;; missing) /usr/bin/rm "$3"; exit 9 ;; stamp) /usr/bin/rm "$2/DEPLOYED_COMMIT"; exit 9 ;; esac
fi
`,
    cp: `#!/bin/bash
if [[ "$RESTORE_FAIL" == true && "$3" == *scheduler.*/1 ]]; then echo simulated-restore-failure >&2; exit 12; fi
exec /usr/bin/cp "$@"
`,
    curl: `#!/bin/bash
if [[ "$*" == *health/deployment/* ]]; then
  printf '{"status":"ok","commit":"%s","database":"ok","catalog":"database"}' "$HEALTH_SHA"
else printf '{"legacyRouteInactive":true,"commit":"%s"}' "$NEW_SHA"; fi
`,
    systemctl: `#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE/log"
unit="\${@: -1}"
case "$1" in
  is-enabled) if [[ -f "$FIXTURE/state-$unit" ]]; then cut -d ' ' -f1 "$FIXTURE/state-$unit"; else echo disabled; fi ;;
  is-active) if [[ -f "$FIXTURE/state-$unit" ]]; then cut -d ' ' -f2 "$FIXTURE/state-$unit"; else echo inactive; fi ;;
  disable) echo 'disabled inactive' > "$FIXTURE/state-$unit" ;;
  enable) echo 'enabled active' > "$FIXTURE/state-$unit"
    if [[ "$unit" == festival-radar-db-due.timer && "$PARTIAL_ENABLE" == true ]]; then exit 7; fi ;;
  stop) : ;; # Failed oneshots stay failed; stopping does not reset them.
esac
`,
  };
  for (const [name, content] of Object.entries(stubs)) await writeFile(dir + '/bin/' + name, content, { mode: 0o755 });
  await writeFile(dir + '/state-' + timer, 'enabled active\n');
  for (const unit of [scheduler, tick]) await writeFile(dir + '/state-' + unit,
    'disabled ' + (options.failedUnit === unit || options.failedUnit === 'both' ? 'failed' : 'inactive') + '\n');
  await writeFile(dir + '/installer', mapped(await readFile('scripts/deploy/install-release.sh', 'utf8')));
  const archive = dir + '/release.tar.gz';
  const packed = spawnSync('tar', ['-czf', archive, '-C', dir + '/stage', 'app'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  await writeFile(dir + '/env', 'NEW_ENV=true\n');
  const result = spawnSync('bash', [dir + '/installer', archive, sha, dir + '/env'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: dir + '/bin:' + process.env.PATH,
      FIXTURE: dir, NODE_BIN: process.execPath, NEW_RELEASE: release, OLD_RELEASE: oldRelease, NEW_SHA: sha,
      HEALTH_SHA: options.unhealthy ? oldSha : sha, FAIL_CHOWN: String(!!options.failChown),
      ACTIVATION: options.activation || '', ROLLBACK_FAIL: String(!!options.rollbackFail),
      RESTORE_FAIL: String(!!options.restoreFail), PARTIAL_ENABLE: String(!!options.partialEnable) },
  });
  const log = await readFile(dir + '/log', 'utf8').catch(() => { throw new Error('installer exited early: ' + result.status + ' ' + result.stderr); });
  return { dir, root, release, oldRelease, prior, result, log };
}

async function assertNew(h) {
  for (const asset of assets) {
    const value = await readFile(h.dir + '/' + asset, 'utf8');
    assert.notEqual(value, h.prior.get(asset), asset);
    assert.ok(!value.includes(oldSha), asset);
    if (asset.endsWith('@.service') || asset.endsWith('scheduler.service')) assert.ok(value.includes(sha), asset);
    if (asset.startsWith('libexec/')) assert.equal(value,
      await readFile(h.release + '/scripts/deploy/' + path.basename(asset), 'utf8'), asset);
  }
}
async function assertOff(h) {
  assert.equal(await readFile(h.dir + '/state-' + timer, 'utf8'), 'disabled inactive\n');
  assert.doesNotMatch(h.log, /reset-failed/);
}

test('post-activation retained failed scheduler/tick refuses rearm and keeps new pinned assets', async t => {
  for (const failedUnit of [scheduler, tick, 'both']) {
    const h = await fixture(t, { failedUnit });
    assert.equal(h.result.status, 6, h.result.stderr);
    assert.match(h.result.stderr, /rearm state ambiguous/);
    assert.equal(await readlink(h.root + '/current'), h.release);
    await assertNew(h); await assertOff(h);
    assert.doesNotMatch(h.log, /enable --now festival-radar-db-due.timer/);
    for (const unit of failedUnit === 'both' ? [scheduler, tick] : [failedUnit])
      assert.equal(await readFile(h.dir + '/state-' + unit, 'utf8'), 'disabled failed\n');
  }
});

test('real failed-health rollback selects prior stamped release, environment and exact asset snapshot', async t => {
  const h = await fixture(t, { unhealthy: true, failedUnit: 'both' });
  assert.equal(h.result.status, 1, h.result.stderr);
  assert.match(h.result.stderr, /previous release restored/);
  assert.equal(await readlink(h.root + '/current'), h.oldRelease);
  for (const asset of assets) assert.equal(await readFile(h.dir + '/' + asset, 'utf8'), h.prior.get(asset));
  assert.equal(await readFile(h.root + '/shared/production.env', 'utf8'), 'PRIOR_ENV=true\n');
  await assertOff(h);
  assert.doesNotMatch(h.log, /enable --now festival-radar-db-due.timer/);
});

test('activation and rollback transition failures decide restoration from actual stamped current', async t => {
  const before = await fixture(t, { activation: 'before' });
  assert.equal(before.result.status, 9, before.result.stderr);
  assert.equal(await readlink(before.root + '/current'), before.oldRelease);
  for (const asset of assets) assert.equal(await readFile(before.dir + '/' + asset, 'utf8'), before.prior.get(asset));
  await assertOff(before);
  for (const options of [{ activation: 'after' }, { activation: 'missing' }, { activation: 'stamp' },
    { activation: 'before-stamp' },
    { failChown: true }, { unhealthy: true, rollbackFail: true }, { unhealthy: true, fresh: true },
    { unhealthy: true, oldStamp: 'c'.repeat(40) }, { partialEnable: true }]) {
    const h = await fixture(t, options);
    assert.notEqual(h.result.status, 0, h.result.stderr);
    assert.match(h.result.stderr, /active release uncertain; old assets not restored; recovery snapshots retained/);
    const retained = h.result.stderr.match(/snapshots retained: (\S+) (\S+)/);
    assert.ok(retained);
    assert.equal(await readFile(retained[1] + '/1', 'utf8'), h.prior.get('system/' + scheduler));
    assert.equal(await readFile(retained[2] + '/unit', 'utf8'), h.prior.get(assets[0]));
    assert.match(h.log, /daemon-reload/);
    if (options.activation !== 'missing') assert.equal(await readlink(h.root + '/current'),
      options.activation === 'before-stamp' ? h.oldRelease : h.release);
    await assertNew(h); await assertOff(h);
    await rm(retained[1], { recursive: true, force: true });
    await rm(retained[2], { recursive: true, force: true });
  }
});

test('failed cleanup retains recovery snapshots and the original failure status', async t => {
  const h = await fixture(t, { activation: 'before', restoreFail: true });
  assert.equal(h.result.status, 9, h.result.stderr);
  assert.match(h.result.stderr, /asset cleanup failed; recovery snapshots retained/);
  assert.equal(await readlink(h.root + '/current'), h.oldRelease);
  const backupPaths = h.result.stderr.match(/snapshots retained: (\S+) (\S+)/);
  assert.ok(backupPaths);
  assert.equal(await readFile(backupPaths[1] + '/1', 'utf8'), h.prior.get('system/' + scheduler));
  assert.equal(await readFile(backupPaths[2] + '/unit', 'utf8'), h.prior.get(assets[0]));
  await assertOff(h);
  await rm(backupPaths[1], { recursive: true, force: true });
  await rm(backupPaths[2], { recursive: true, force: true });
});
