import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { checkGates, validateEvidence, validateInputs, validateRuns } from '../scripts/deploy/check-logo-apply-gates.mjs';
const sha = 'a'.repeat(40);
const body = `LOGO_IMPORT_BACKUP_RESTORE_V1\ndeployment=${sha}\nbackup_sha256=${'b'.repeat(64)}\nrestore_report_sha256=${'c'.repeat(64)}\nattestation=backup-restored-and-validated`;
const digest = createHash('sha256').update(body).digest('hex');
const env = { GITHUB_REPOSITORY: 'KirDE/festival-radar', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha,
  APPLY_SHA: sha, EVIDENCE_DIGEST: digest, EVIDENCE_COMMENT: '123', APPLY_CONFIRMATION: `APPLY-47-${sha}-${digest}`,
  EXPECTED_EXISTING: '0', RESTORE_ATTESTED: 'true' };
const record = { id: 123, body, issue_url: 'https://api.github.com/repos/KirDE/festival-radar/issues/210' };
const runs = { workflow_runs: [{ head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] };

test('SHA/evidence-bound authorization has no permissive defaults or arbitrary input', () => {
  assert.deepEqual(validateInputs(env), { sha, digest, comment: '123' });
  for (const [key, value] of Object.entries({ GITHUB_REF: 'refs/heads/feature', GITHUB_REPOSITORY: 'fork/festival-radar',
    GITHUB_SHA: 'b'.repeat(40), APPLY_SHA: 'main', EVIDENCE_DIGEST: 'https://example.com', EVIDENCE_COMMENT: '1;echo leak',
    APPLY_CONFIRMATION: 'apply', EXPECTED_EXISTING: '1', RESTORE_ATTESTED: 'false' })) {
    assert.throws(() => validateInputs({ ...env, [key]: value }), /authorization rejected/);
  }
});
test('backup/restore is human evidence pinned by comment identity, exact body and deployment', () => {
  validateEvidence(record, { sha, digest, comment: '123' });
  for (const change of [{ body: body + '\nmodified' }, { id: 124 }, { issue_url: 'https://api.github.com/repos/KirDE/festival-radar/issues/211' }]) {
    assert.throws(() => validateEvidence({ ...record, ...change }, { sha, digest, comment: '123' }), /evidence rejected/);
  }
});
test('exact-head successful main Quality and Deploy are mandatory', async () => {
  const visited = [];
  await checkGates(env, async path => {
    visited.push(path);
    if (path.endsWith('/commits/main')) return { sha };
    if (path.includes('/actions/')) return runs;
    return record;
  });
  assert.equal(visited.length, 4);
  await assert.rejects(checkGates(env, async () => ({ sha: 'b'.repeat(40) })), /head changed/);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' }]) {
    assert.throws(() => validateRuns({ workflow_runs: [{ ...runs.workflow_runs[0], ...change }] }, sha), /check rejected/);
  }
});
