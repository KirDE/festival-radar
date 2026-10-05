// Fail closed without printing API response bodies, input text, URLs or exceptions.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validateInputs(env) {
  const { APPLY_SHA: sha, EVIDENCE_DIGEST: digest, EVIDENCE_COMMENT: comment,
    APPLY_CONFIRMATION: confirmation, EXPECTED_EXISTING: existing, RESTORE_ATTESTED: attested } = env;
  if (env.GITHUB_REPOSITORY !== 'KirDE/festival-radar' || env.GITHUB_REF !== 'refs/heads/main' ||
      !/^[0-9a-f]{40}$/.test(sha ?? '') || sha !== env.GITHUB_SHA ||
      !/^[0-9a-f]{64}$/.test(digest ?? '') || !/^[1-9][0-9]{0,15}$/.test(comment ?? '') ||
      confirmation !== `APPLY-47-${sha}-${digest}` || !['0', '47'].includes(existing) || attested !== 'true') {
    throw new Error('Logo apply authorization rejected');
  }
  return { sha, digest, comment };
}

export function validateEvidence(record, { sha, digest, comment }) {
  const pattern = new RegExp('^LOGO_IMPORT_BACKUP_RESTORE_V1\\ndeployment=' + sha +
    '\\nbackup_sha256=[0-9a-f]{64}\\nrestore_report_sha256=[0-9a-f]{64}\\nattestation=backup-restored-and-validated\\n?$');
  if (String(record.id) !== comment || record.issue_url !== 'https://api.github.com/repos/KirDE/festival-radar/issues/210' ||
      typeof record.body !== 'string' || !pattern.test(record.body) ||
      createHash('sha256').update(record.body).digest('hex') !== digest) throw new Error('Logo backup restore evidence rejected');
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
  validateEvidence(await request(base + '/issues/comments/' + input.comment), input);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkGates(process.env, async path => {
      const response = await fetch('https://api.github.com' + path, {
        headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
      if (!response.ok) throw new Error('Logo gate unavailable');
      return response.json();
    });
    console.log('logo apply gates passed (restore is operator-attested)');
  } catch { console.error('logo apply gates rejected'); process.exitCode = 1; }
}
