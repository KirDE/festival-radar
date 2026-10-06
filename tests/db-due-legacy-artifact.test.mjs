import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { diagnoseLegacyArtifacts, parseFailedStart } from '../scripts/deploy/diagnose-legacy-ingestion.mjs';
import { validateLegacyArtifact } from '../scripts/validate-db-due-legacy-artifact.mjs';
const now = 1791255601, start = now - 300, sha = 'a'.repeat(40);
const record = 'LoadState=loaded\nActiveState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=1\nExecMainStartTimestamp=Tue 2026-10-06 03:00:01 UTC\n';
const writeAt = async (dir, name, content, time) => {
  const file = path.join(dir, name); await writeFile(file, content); await utimes(file, time, time); return file;
};
const classify = dir => diagnoseLegacyArtifacts(start, dir, now);
const expected = (status, reason = 'safe-evidence') => ({ status, reason });
test('strict oneshot snapshot and bounded marker', () => {
  assert.deepEqual(parseFailedStart(record), { start: now, reason: 'safe-evidence' });
  assert.deepEqual(parseFailedStart(''), { start: null, reason: 'systemd-unavailable' });
  assert.deepEqual(parseFailedStart(record.replace('ExecMainStartTimestamp=Tue 2026-10-06 03:00:01 UTC\n', '')), { start: null, reason: 'start-absent' });
  assert.deepEqual(parseFailedStart(record.replace('ExecMainStartTimestamp=Tue 2026-10-06 03:00:01 UTC', 'ExecMainStartTimestamp=')), { start: null, reason: 'start-absent' });
  assert.deepEqual(parseFailedStart(record.replace('UTC', 'bad/zone')), { start: null, reason: 'start-invalid' });
  for (const bad of [record + record, record.replace('failed', 'private'), record.replace('ExecMainStatus=1', 'ExecMainStatus=0'),
    record.replace('UTC', 'unsafe/zone'), record + 'Private=secret\n', record.replace('LoadState=loaded\n', ''), 'x'.repeat(641)])
    assert.equal(parseFailedStart(bad).start, null);
  const good = 'DB_DUE_LEGACY_ARTIFACT status=current-temp reason=safe-evidence\n';
  const unknown = 'DB_DUE_LEGACY_ARTIFACT status=unknown reason=collection-missing\n';
  assert.equal(validateLegacyArtifact(Buffer.from(unknown), sha), unknown);
  assert.equal(validateLegacyArtifact(Buffer.from(good), sha), good);
  for (const bad of [good + good, good + 'private', good.trim(), 'DB_DUE_LEGACY_ARTIFACT status=unknown reason=safe-evidence\n', 'DB_DUE_LEGACY_ARTIFACT status=no-artifact reason=collection-missing\n', 'DB_DUE_LEGACY_ARTIFACT status=private reason=secret\n', 'x'.repeat(257)])
    assert.throws(() => validateLegacyArtifact(Buffer.from(bad), sha), /rejected/);
});
test('current failure evidence vs retained success, malformed, missing, oversize, symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legacy-artifact-'));
  try {
    assert.deepEqual(await classify(dir), expected('no-artifact'));
    await writeAt(dir, 'latest.json', '{"summary":{"status":"COMPLETED"},"readBack":{"status":"COMPLETED"},"private":"secret"}', start - 60);
    assert.deepEqual(await classify(dir), expected('retained-success-no-current-artifact'));
    await writeAt(dir, 'latest.json.tmp', 'private response', start);
    assert.deepEqual(await classify(dir), expected('inconclusive'));
    await writeAt(dir, 'latest.json.tmp', 'private response', start + 30);
    assert.deepEqual(await classify(dir), expected('current-temp'));
    await utimes(path.join(dir, 'latest.json.tmp'), start - 60, start - 60);
    assert.deepEqual(await classify(dir), expected('retained-success-no-current-artifact'));
    await writeAt(dir, 'latest.json', '{"summary":{"status":"PARTIAL"},"readBack":{"status":"PARTIAL"}}', start + 10);
    assert.deepEqual(await classify(dir), expected('current-success-artifact'));
    await writeAt(dir, 'latest.json', '{"summary":{"status":"FAILED"},"readBack":{"status":"FAILED"}}', start + 10);
    assert.deepEqual(await classify(dir), expected('current-other-artifact'));
    await writeAt(dir, 'latest.json', '{broken', start - 60);
    assert.deepEqual(await classify(dir), expected('unknown', 'final-evidence-invalid'));
    await writeAt(dir, 'latest.json', 'x'.repeat(65537), start - 60);
    assert.deepEqual(await classify(dir), expected('unknown', 'final-file-unsafe'));
    await rm(path.join(dir, 'latest.json'));
    await writeAt(dir, 'latest.json.tmp', 'x'.repeat(1048577), start + 10);
    assert.deepEqual(await classify(dir), expected('unknown', 'temp-file-unsafe'));
    await rm(path.join(dir, 'latest.json.tmp'));
    await symlink('/etc/passwd', path.join(dir, 'latest.json'));
    assert.deepEqual(await classify(dir), expected('unknown', 'final-file-unsafe'));
    await rm(path.join(dir, 'latest.json'));
    await symlink('/etc/passwd', path.join(dir, 'latest.json.tmp'));
    assert.deepEqual(await classify(dir), expected('unknown', 'temp-file-unsafe'));
    assert.deepEqual(await classify(path.join(dir, 'absent')), expected('unknown', 'collection-missing'));
    const link = path.join(dir, 'parent-link'); await symlink(dir, link);
    assert.deepEqual(await classify(path.join(link, 'absent')), expected('unknown', 'collection-unsafe'));
    assert.deepEqual(await classify(link), expected('unknown', 'collection-unsafe'));
    assert.deepEqual(await diagnoseLegacyArtifacts(now + 120, dir, now), expected('unknown', 'start-invalid'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('manual protected workflow uses only fixed SHA mode and validates exact marker', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile('.github/workflows/db-due-legacy-artifact.yml', 'utf8');
  const dispatcher = await readFile('scripts/deploy/activate-release', 'utf8');
  const scheduler = await readFile('scripts/deploy/db-due-scheduler', 'utf8');
  const packageScript = await readFile('scripts/deploy/package-release.sh', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: festival-radar-production/);
  assert.match(workflow, /StrictHostKeyChecking yes/);
  assert.match(workflow, /due-legacy-artifact-diagnose > "\$audit" 2>\/dev\/null/);
  assert.match(workflow, /node scripts\/validate-db-due-legacy-artifact.mjs "\$GITHUB_SHA" < "\$audit"/);
  assert.doesNotMatch(workflow, /inputs:|schedule:|tee |cat "\$audit"|set -x/);
  assert.match(dispatcher, /due-legacy-artifact-diagnose\) exec .*db-due-scheduler "\$commit" diagnose-legacy-artifact/);
  const branch = scheduler.slice(scheduler.indexOf('if [[ "$action" == diagnose-legacy-artifact ]]; then'), scheduler.indexOf('if [[ "$action" == health ]]; then'));
  assert.match(branch, /ExecMainStartTimestamp/);
  assert.match(branch, /runuser -u www-data --/);
  assert.match(branch, /head -c 257/);
  assert.match(branch, /reason=\(systemd-unavailable/);
  assert.doesNotMatch(branch, /systemctl (start|stop|enable|disable)|journalctl|curl |request.json/);
  assert.match(packageScript, /cp scripts\/deploy\/diagnose-legacy-ingestion.mjs/);
  assert.match(packageScript, /grep -Fxq 'app\/scripts\/deploy\/diagnose-legacy-ingestion.mjs'/);
});
test('packaged CLI runs through a current-style symlink and reads no arbitrary paths', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const original = fileURLToPath(new URL('../scripts/deploy/diagnose-legacy-ingestion.mjs', import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), 'legacy-cli-symlink-'));
  try {
    const linked = path.join(dir, 'current.mjs');
    await symlink(original, linked);
    for (const entry of [original, linked]) {
      const result = spawnSync(process.execPath, [entry], { input: 'malformed systemd record', encoding: 'utf8' });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, 'DB_DUE_LEGACY_ARTIFACT status=unknown reason=systemd-invalid\n');
      assert.equal(result.stderr, '');
      const rejected = spawnSync(process.execPath, [entry, '/etc/passwd'], { input: '', encoding: 'utf8' });
      assert.equal(rejected.stdout, 'DB_DUE_LEGACY_ARTIFACT status=unknown reason=systemd-unavailable\n');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('diagnostic targets actual ingestion collection artifact names', async () => {
  const { readFile } = await import('node:fs/promises');
  const runner = await readFile('scripts/deploy/run-collection-job.sh', 'utf8');
  const reader = await readFile('scripts/deploy/diagnose-legacy-ingestion.mjs', 'utf8');
  assert.match(runner, /output="\$shared\/collection-jobs\/\$job"/);
  assert.match(runner, /\$output\/latest\.json\.tmp/);
  assert.match(runner, /\$output\/latest\.json/);
  assert.match(reader, /const DIRECTORY = '\/opt\/festival-radar\/shared\/collection-jobs\/ingestion'/);
  assert.match(reader, /inspect\('latest\.json', true\)/);
  assert.match(reader, /inspect\('latest\.json\.tmp', false\)/);
});
