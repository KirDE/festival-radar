import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGates, INVENTORY_DIGEST, parseProofAudit, validateInputs, validateRuns } from '../scripts/deploy/check-logo-apply-gates.mjs';
const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'KirDE/festival-radar', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha,
  APPLY_SHA: sha, APPLY_CONFIRMATION: `APPLY-47-${sha}`, EXPECTED_EXISTING: '0' };
const runs = { workflow_runs: [{ head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] };

test('SHA-bound explicit confirmation accepts no human evidence and has no permissive defaults', () => {
  assert.deepEqual(validateInputs(env), { sha });
  for (const [key, value] of Object.entries({ GITHUB_REF: 'refs/heads/feature', GITHUB_REPOSITORY: 'fork/festival-radar',
    GITHUB_SHA: 'b'.repeat(40), APPLY_SHA: 'main', APPLY_CONFIRMATION: 'apply', EXPECTED_EXISTING: '1',
    EVIDENCE_DIGEST: 'b'.repeat(64), EVIDENCE_COMMENT: '123', RESTORE_ATTESTED: 'true' })) {
    assert.throws(() => validateInputs({ ...env, [key]: value }), /authorization rejected/);
  }
});
test('root proof audit derives only an exact digest from canonical bounded fresh SHA/source-bound output', () => {
  const now = 1000;
  const record = { status: 'ok', release: sha, inventoryDigest: INVENTORY_DIGEST, proofDigest: 'b'.repeat(64), expiresAt: now + 300 };
  const frame = value => 'LOGO_RESTORE_PROOF ' + JSON.stringify(value) + '\n';
  const raw = frame(record);
  assert.equal(parseProofAudit(raw, sha, now), record.proofDigest);
  for (const changed of [{ status: 'failed' }, { release: 'c'.repeat(40) }, { inventoryDigest: 'd'.repeat(64) },
    { proofDigest: 'secret URL' }, { expiresAt: now }, { expiresAt: now + 301 }, { extra: 'secret' }]) {
    assert.throws(() => parseProofAudit(frame({ ...record, ...changed }), sha, now));
  }
  for (const bad of [raw + '\n', raw + raw, raw + '\0', raw.slice(0, -1), 'secret URL\n',
    raw.replace('"status":"ok"', '"status":"failed","status":"ok"'), 'x'.repeat(513)]) {
    assert.throws(() => parseProofAudit(bad, sha, now));
  }
});
test('exact-head successful main Quality and Deploy remain mandatory without comments or approval claims', async () => {
  const visited = [];
  await checkGates(env, async path => {
    visited.push(path);
    if (path.endsWith('/commits/main')) return { sha };
    return runs;
  });
  assert.equal(visited.length, 3);
  assert.equal(visited.some(path => path.includes('/issues/')), false);
  await assert.rejects(checkGates(env, async () => ({ sha: 'b'.repeat(40) })), /head changed/);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' }]) {
    assert.throws(() => validateRuns({ workflow_runs: [{ ...runs.workflow_runs[0], ...change }] }, sha), /check rejected/);
  }
});
