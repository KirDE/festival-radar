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
test('strict oneshot snapshot and bounded marker', () => {
  assert.equal(parseFailedStart(record), now);
  for (const bad of [record + record, record.replace('failed', 'private'), record.replace('ExecMainStatus=1', 'ExecMainStatus=0'),
    record.replace('UTC', 'unsafe/zone'), record + 'Private=secret\n', record.replace('LoadState=loaded\n', ''), 'x'.repeat(641)])
    assert.equal(parseFailedStart(bad), null);
  const good = 'DB_DUE_LEGACY_ARTIFACT status=current-temp\n';
  assert.equal(validateLegacyArtifact(Buffer.from(good), sha), good);
  for (const bad of [good + good, good + 'private', good.trim(), 'DB_DUE_LEGACY_ARTIFACT status=private\n', 'x'.repeat(257)])
    assert.throws(() => validateLegacyArtifact(Buffer.from(bad), sha), /rejected/);
});
test('current failure evidence vs retained success, malformed, missing, oversize, symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'legacy-artifact-'));
  try {
    assert.equal(await classify(dir), 'no-artifact');
    await writeAt(dir, 'latest.json', '{"summary":{"status":"COMPLETED"},"readBack":{"status":"COMPLETED"},"private":"secret"}', start - 60);
    assert.equal(await classify(dir), 'retained-success-no-current-artifact');
    await writeAt(dir, 'latest.json.tmp', 'private response', start);
    assert.equal(await classify(dir), 'inconclusive');
    await writeAt(dir, 'latest.json.tmp', 'private response', start + 30);
    assert.equal(await classify(dir), 'current-temp');
    await utimes(path.join(dir, 'latest.json.tmp'), start - 60, start - 60);
    assert.equal(await classify(dir), 'retained-success-no-current-artifact');
    await writeAt(dir, 'latest.json', '{"summary":{"status":"PARTIAL"},"readBack":{"status":"PARTIAL"}}', start + 10);
    assert.equal(await classify(dir), 'current-success-artifact');
    await writeAt(dir, 'latest.json', '{"summary":{"status":"FAILED"},"readBack":{"status":"FAILED"}}', start + 10);
    assert.equal(await classify(dir), 'current-other-artifact');
    await writeAt(dir, 'latest.json', '{broken', start - 60);
    assert.equal(await classify(dir), 'unknown');
    await writeAt(dir, 'latest.json', 'x'.repeat(65537), start - 60);
    assert.equal(await classify(dir), 'unknown');
    await rm(path.join(dir, 'latest.json'));
    await writeAt(dir, 'latest.json.tmp', 'x'.repeat(1048577), start + 10);
    assert.equal(await classify(dir), 'unknown');
    await rm(path.join(dir, 'latest.json.tmp'));
    await symlink('/etc/passwd', path.join(dir, 'latest.json'));
    assert.equal(await classify(dir), 'unknown');
    await rm(path.join(dir, 'latest.json'));
    await symlink('/etc/passwd', path.join(dir, 'latest.json.tmp'));
    assert.equal(await classify(dir), 'unknown');
    assert.equal(await classify(path.join(dir, 'absent')), 'unknown');
    const link = path.join(dir, 'parent-link'); await symlink(dir, link);
    assert.equal(await classify(path.join(link, 'absent')), 'unknown');
    assert.equal(await diagnoseLegacyArtifacts(now + 120, dir, now), 'unknown');
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
  assert.doesNotMatch(branch, /systemctl (start|stop|enable|disable)|journalctl|curl |request.json/);
  assert.match(packageScript, /cp scripts\/deploy\/diagnose-legacy-ingestion.mjs/);
  assert.match(packageScript, /grep -Fxq 'app\/scripts\/deploy\/diagnose-legacy-ingestion.mjs'/);
});
