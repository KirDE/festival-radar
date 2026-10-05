// No caller evidence/restore attestation is accepted. Root proves the pinned restore.
import { pathToFileURL } from 'node:url';
export const INVENTORY_DIGEST = '99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456';

export function validateInputs(env) {
  const { APPLY_SHA: sha, APPLY_CONFIRMATION: confirmation, EXPECTED_EXISTING: existing } = env;
  if (env.GITHUB_REPOSITORY !== 'KirDE/festival-radar' || env.GITHUB_REF !== 'refs/heads/main' ||
      !/^[0-9a-f]{40}$/.test(sha ?? '') || sha !== env.GITHUB_SHA ||
      confirmation !== `APPLY-47-${sha}` || !['0', '47'].includes(existing) ||
      ['EVIDENCE_DIGEST', 'EVIDENCE_COMMENT', 'RESTORE_ATTESTED'].some(key => env[key] !== undefined)) {
    throw new Error('Logo apply authorization rejected');
  }
  return { sha };
}

export function parseProofAudit(raw, sha, now = Math.floor(Date.now() / 1000)) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 512 || !/^[\x20-\x7e]+\n$/.test(raw)) {
    throw new Error('Logo root proof audit rejected');
  }
  const prefix = 'LOGO_RESTORE_PROOF ';
  if (!raw.startsWith(prefix)) throw new Error('Logo root proof audit rejected');
  const record = JSON.parse(raw.slice(prefix.length));
  const expected = { status: 'ok', release: sha, inventoryDigest: INVENTORY_DIGEST,
    proofDigest: record.proofDigest, expiresAt: record.expiresAt };
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^[0-9a-f]{64}$/.test(record.proofDigest ?? '') ||
      !Number.isSafeInteger(record.expiresAt) || !Number.isSafeInteger(now) ||
      record.expiresAt <= now || record.expiresAt > now + 300 ||
      raw !== prefix + JSON.stringify(expected) + '\n') throw new Error('Logo root proof audit rejected');
  return record.proofDigest;
}

export function validateRuns(data, sha) {
  if (!Array.isArray(data.workflow_runs) || !data.workflow_runs.some(run =>
    run.head_sha === sha && run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event) &&
    run.status === 'completed' && run.conclusion === 'success')) throw new Error('Logo exact-head check rejected');
}

export async function checkGates(env, request) {
  const input = validateInputs(env);
  const base = '/repos/KirDE/festival-radar';
  const head = await request(base + '/commits/main');
  if (head.sha !== input.sha) throw new Error('Logo main head changed');
  for (const workflow of ['quality.yml', 'deploy.yml']) {
    validateRuns(await request(base + '/actions/workflows/' + workflow + '/runs?head_sha=' + input.sha + '&branch=main&per_page=100'), input.sha);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === 'proof-audit') {
      validateInputs(process.env);
      let raw = '';
      for await (const chunk of process.stdin) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw) > 512) throw new Error('Rejected');
      }
      console.log('proof_digest=' + parseProofAudit(raw, process.env.APPLY_SHA));
    } else {
      if (process.argv.length !== 2) throw new Error('Rejected');
      await checkGates(process.env, async path => {
        const response = await fetch('https://api.github.com' + path, {
          headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15_000), redirect: 'error',
        });
        if (!response.ok) throw new Error('Logo gate unavailable');
        return response.json();
      });
      console.log('logo exact-head gates passed; root restore proof required');
    }
  } catch { console.error('logo apply gates rejected'); process.exitCode = 1; }
}
