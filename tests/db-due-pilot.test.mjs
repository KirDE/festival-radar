import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const good = JSON.stringify({ due: 52, queueLaggedOverHour: 0, active: 0, expired: 0, error: 0,
  outboxPending: 0, outboxLaggedOverHour: 0, unknownParserKeys: 0 });
const audit = JSON.stringify({ attempted: 1, processed: 1, published: 0, reviewRequired: 0, fetchErrors: 0 });

test('fixed dispatch shares deploy lock and has no source, mode or shell input', async () => {
  const [workflow, route, starter, runner, installer, packager] = await Promise.all([
    '.github/workflows/db-due-ingest-pilot.yml', 'app/api/ingestion/run/route.ts', 'scripts/deploy/start-db-due',
    'scripts/deploy/run-db-due-operation.sh', 'scripts/deploy/install-release.sh', 'scripts/deploy/package-release.sh',
  ].map((p) => readFile(p, 'utf8')));
  assert.match(workflow, /workflow_dispatch:\n\nconcurrency:/);
  assert.doesNotMatch(workflow, /inputs:|schedule:|slug|spotify|playlists/);
  assert.match(workflow, /group: festival-radar-production/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /activate-release \"\$GITHUB_SHA\" due-ingest-pilot/);
  assert.match(route, /execute\(\"\/usr\/bin\/flock\", \[\"-n\", \"-F\", \"\/opt\/festival-radar\/shared\/ingestion\/source-fetch.lock\"/);
  assert.match(starter, /flock -n 8/);
  assert.match(starter, /systemctl show --property=ActiveState --value festival-radar-collection@ingestion.service/);
  assert.match(installer, /source-fetch.lock/);
  assert.match(installer, /StandardOutput=append:\/run\/festival-radar-db-due\/%i\.audit\nStandardError=null/);
  assert.match(runner, /--db-due --publish --max-fetch-errors=0/);
  assert.match(packager, /scripts\/report-db-due-pilot.mjs/);
  assert.doesNotMatch(installer, /db-due-ingest.*timer/);
});

test('summary audit validates exactly one completed attempt and never prints protected fields', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-summary-'));
  try {
    const file = path.join(dir, 'summary.json');
    const run = () => spawnSync(process.execPath, ['scripts/report-db-due-pilot.mjs', file], { encoding: 'utf8' });
    const base = { status: 'COMPLETED', dryRun: false, totalSources: 1, attempted: 1,
      processed: 1, published: 0, reviewRequired: 1, fetchErrors: 0, results: [{ url: 'PRIVATE_URL' }] };
    await writeFile(file, JSON.stringify(base));
    assert.equal(run().stdout, JSON.stringify({ attempted: 1, processed: 1, published: 0, reviewRequired: 1, fetchErrors: 0 }) + '\n');
    for (const bad of [{ ...base, attempted: 0 }, { ...base, attempted: 2 }, { ...base, fetchErrors: 1 },
      { ...base, status: 'PARTIAL' }, { ...base, published: 1 }, { ...base, processed: 0 }]) {
      await writeFile(file, JSON.stringify(bad));
      const result = run();
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_URL|results|url/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('root path rejects active legacy, held fetch lock, unhealthy preflight and malformed audit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-pilot-wrapper-'));
  const sha = 'a'.repeat(40);
  const root = path.join(dir, 'root');
  const release = path.join(root, 'releases', sha);
  const bin = path.join(dir, 'bin');
  const privateDir = path.join(dir, 'audit');
  const unit = path.join(dir, 'unit');
  const lock = path.join(root, 'shared/ingestion/source-fetch.lock');
  try {
    await mkdir(release, { recursive: true });
    await mkdir(path.dirname(lock), { recursive: true });
    await mkdir(bin);
    await symlink(release, path.join(root, 'current'));
    await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
    await writeFile(lock, '', { mode: 0o640 });
    await writeFile(unit, 'unit');
    await writeFile(path.join(bin, 'id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
    await writeFile(path.join(bin, 'systemctl'), '#!/bin/sh\nif [ "$1" = show ]; then echo "${TEST_ACTIVE:-inactive}"; exit 0; fi\nprintf "%s\\n" "$2" >> "$TEST_LOG"\nif [ "$2" = festival-radar-db-due@health.service ]; then printf "%s\\n" "$TEST_HEALTH" > "$TEST_AUDIT_DIR/health.audit"; else printf "%s\\n" "$TEST_INGEST" > "$TEST_AUDIT_DIR/ingest.audit"; exit "${TEST_INGEST_EXIT:-0}"; fi\n', { mode: 0o755 });
    let wrapper = await readFile('scripts/deploy/start-db-due', 'utf8');
    wrapper = wrapper.replace('root=/opt/festival-radar', 'root=' + root)
      .replace('/run/festival-radar-activation.lock', path.join(dir, 'activation.lock'))
      .replace('/etc/systemd/system/festival-radar-db-due@.service', unit)
      .replace('/run/festival-radar-db-due', privateDir)
      .replaceAll('0:700', process.getuid() + ':700').replaceAll('0:600', process.getuid() + ':600')
      .replace('www-data:640', userInfo().username + ':640');
    const file = path.join(dir, 'wrapper');
    await writeFile(file, wrapper, { mode: 0o755 });
    const log = path.join(dir, 'calls');
    const run = (extra = {}) => spawnSync('bash', [file, sha, 'ingest-pilot'], { encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_HEALTH: good, TEST_INGEST: audit,
        TEST_AUDIT_DIR: privateDir, TEST_LOG: log, ...extra } });
    assert.equal(run({ TEST_ACTIVE: 'active' }).status, 6);
    assert.equal(run({ TEST_HEALTH: good.replace('"unknownParserKeys":0', '"unknownParserKeys":1') }).status, 6);
    assert.equal(run({ TEST_HEALTH: good.replace('"due":52', '"due":0') }).status, 6);
    assert.equal(run({ TEST_HEALTH: good.replace('"active":0', '"active":1') }).status, 6);
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stdout, 'DB_DUE_PREFLIGHT ' + good + '\nDB_DUE_PILOT ' + audit + '\n');
    const malformed = run({ TEST_INGEST: audit + ' PRIVATE_URL' });
    assert.equal(malformed.status, 6);
    assert.equal(malformed.stdout, 'DB_DUE_PREFLIGHT ' + good + '\n');
    assert.doesNotMatch(malformed.stdout + malformed.stderr, /PRIVATE_URL/);
    const stage = run({ TEST_INGEST_EXIT: '1', TEST_INGEST: 'DB_DUE_FAILURE_STAGE lease_completion' });
    assert.equal(stage.status, 6);
    assert.equal(stage.stdout, 'DB_DUE_PREFLIGHT ' + good + '\n');
    assert.equal(stage.stderr, 'DB_DUE_FAILURE_STAGE lease_completion\nDB due operation failed\n');
    for (const record of [
      'DB_DUE_FAILURE_STAGE PRIVATE_URL',
      'DB_DUE_FAILURE_STAGE publication\nDB_DUE_FAILURE_STAGE publication',
      'DB_DUE_FAILURE_STAGE publication\nPRIVATE_URL',
      'DB_DUE_FAILURE_STAGE publication' + 'x'.repeat(512),
      'PRIVATE_URL exception=secret',
    ]) {
      const rejected = run({ TEST_INGEST_EXIT: '1', TEST_INGEST: record });
      assert.equal(rejected.status, 6);
      assert.equal(rejected.stdout, 'DB_DUE_PREFLIGHT ' + good + '\n');
      assert.equal(rejected.stderr, 'DB due operation failed\n');
    }
    const held = spawn('flock', ['-x', lock, 'sh', '-c', 'echo ready; sleep 2'], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((resolve) => held.stdout.once('data', resolve));
    assert.equal(run().status, 5);
    held.kill();
    assert.doesNotMatch(success.stdout, /PRIVATE_URL|http|secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('systemd runner executes one DB-due mode and sanitizes its private artifact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-pilot-unit-'));
  const sha = 'b'.repeat(40);
  const root = path.join(dir, 'root');
  const release = path.join(root, 'releases', sha);
  try {
    await mkdir(path.join(release, '.runtime'), { recursive: true });
    await mkdir(path.join(release, 'scripts'), { recursive: true });
    await mkdir(path.join(root, 'shared'), { recursive: true });
    await symlink(release, path.join(root, 'current'));
    await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
    await writeFile(path.join(release, 'scripts/report-db-due-health.mjs'), '');
    await writeFile(path.join(release, 'scripts/report-db-due-pilot.mjs'), await readFile('scripts/report-db-due-pilot.mjs'));
    const stub = path.join(release, '.runtime/node');
    await writeFile(stub, '#!/bin/sh\nif [ "$1" = scripts/ingest-festivals.mjs ]; then printf "%s\\n" "$*" >> "$TEST_CALLS"; printf "%s\\n" "${GITHUB_SHA:-local}" >> "$TEST_COMMITS"; for arg do case "$arg" in --output=*) output="${arg#--output=}";; esac; done; stat -c "%a" "$output" "$output/worker.stderr" >> "$TEST_PERMS"; if [ "${TEST_WORKER_FAIL:-0}" = 1 ]; then printf "%s" "$TEST_WORKER_STDERR" >&2; exit 9; fi; printf "%s\\n" "$TEST_SUMMARY" > "$output/summary.json"; exit 0; fi\nexec "$TEST_REAL_NODE" "$@"\n', { mode: 0o755 });
    let runner = await readFile('scripts/deploy/run-db-due-operation.sh', 'utf8');
    runner = runner.replace('root=/opt/festival-radar', 'root=' + root)
      .replace('/opt/festival-radar/shared/.db-due.', root + '/shared/.db-due.');
    const file = path.join(dir, 'runner');
    await writeFile(file, runner, { mode: 0o755 });
    const calls = path.join(dir, 'calls');
    const commits = path.join(dir, 'commits');
    const perms = path.join(dir, 'perms');
    const ingestion = await readFile('scripts/ingest-festivals.mjs', 'utf8');
    assert.match(ingestion, /createIngestionRun\(db, \{[^}]*sourceCommit: process\.env\.GITHUB_SHA \|\| "local"/);
    const base = { status: 'COMPLETED', dryRun: false, totalSources: 1, attempted: 1,
      processed: 1, published: 0, reviewRequired: 0, fetchErrors: 0, results: [{ url: 'PRIVATE_URL' }] };
    const run = (summary, commit = sha, inheritedSha = 'f'.repeat(40), extra = {}) => spawnSync('bash', [file, 'ingest', commit], { encoding: 'utf8',
      env: { ...process.env, GITHUB_SHA: inheritedSha ?? undefined, TEST_REAL_NODE: process.execPath,
        TEST_CALLS: calls, TEST_COMMITS: commits, TEST_PERMS: perms, TEST_SUMMARY: JSON.stringify(summary), ...extra } });
    const result = run(base);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, audit + '\n');
    const args = await readFile(calls, 'utf8');
    assert.match(args, /--db-due --publish --max-fetch-errors=0/);
    assert.doesNotMatch(args, /--slug=|--force|playlist|drain/);
    // The DB run uses GITHUB_SHA for sourceCommit; systemd has no GitHub env,
    // and even a forged inherited value must be replaced by the pinned SHA.
    assert.equal(run(base, sha, null).status, 0);
    assert.equal(await readFile(commits, 'utf8'), sha + '\n' + sha + '\n');
    assert.equal(run(base, 'c'.repeat(40)).status, 4);
    await writeFile(path.join(release, 'DEPLOYED_COMMIT'), 'c'.repeat(40));
    assert.equal(run(base).status, 4);
    assert.equal(await readFile(commits, 'utf8'), sha + '\n' + sha + '\n');
    await writeFile(path.join(release, 'DEPLOYED_COMMIT'), sha);
    assert.equal(run({ ...base, attempted: 0 }).status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_URL/);
    const sensitive = 'https://private.example/SECRET?token=abc ID=123 exception=PRIVATE\n';
    const fail = (workerStderr) => run(base, sha, null, { TEST_WORKER_FAIL: '1', TEST_WORKER_STDERR: workerStderr });
    const valid = fail(sensitive + 'db_due_failure_stage=artifact_write\n');
    assert.equal(valid.status, 1);
    assert.equal(valid.stdout, 'DB_DUE_FAILURE_STAGE artifact_write\n');
    assert.equal(valid.stderr, 'DB due ingestion failed\n');
    for (const unsafe of [
      sensitive, sensitive + 'db_due_failure_stage=secret\n',
      'db_due_failure_stage=artifact_write EXTRA\n' + sensitive,
      'db_due_failure_stage=artifact_write\ndb_due_failure_stage=publication\n',
      'db_due_failure_stage=artifact_write\ndb_due_failure_stage=secret\n',
      'db_due_failure_stage=artifact_write\n' + 'x'.repeat(65536),
    ]) {
      const failed = fail(unsafe);
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, 'DB due ingestion failed\n');
    }
    assert.match(await readFile(perms, 'utf8'), /^(700\n600\n)+$/);
    assert.deepEqual(await readdir(path.join(root, 'shared')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deploy-user entrypoint forwards only fixed pilot mode with exact SHA', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'due-pilot-entrypoint-'));
  try {
    const log = path.join(dir, 'calls');
    const wrapper = path.join(dir, 'start-db-due');
    await writeFile(wrapper, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_CALLS"\n', { mode: 0o755 });
    const entrypoint = path.join(dir, 'activate-release');
    let source = await readFile('scripts/deploy/activate-release', 'utf8');
    source = source.replace('/run/festival-radar-activation.lock', path.join(dir, 'lock'))
      .replaceAll('/usr/local/libexec/festival-radar/start-db-due', wrapper);
    await writeFile(entrypoint, source, { mode: 0o755 });
    const sha = 'c'.repeat(40);
    const run = (args) => spawnSync('bash', [entrypoint, ...args], { encoding: 'utf8',
      env: { ...process.env, SUDO_USER: 'festival-radar-deploy', TEST_CALLS: log } });
    assert.equal(run([sha, 'due-ingest-pilot']).status, 0);
    assert.equal(await readFile(log, 'utf8'), sha + ' ingest-pilot\n');
    assert.equal(run([sha, 'due-ingest-pilot', 'anything']).status, 2);
    assert.equal(run([sha, 'due-ingest']).status, 2);
    assert.equal(run(['invalid', 'due-ingest-pilot']).status, 2);
    assert.equal(await readFile(log, 'utf8'), sha + ' ingest-pilot\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
