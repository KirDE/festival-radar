import { readFile, readdir, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function validateCutoverAudit(audit, commit, descendant = false) {
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (!sha(commit) || audit?.version !== 2 || audit?.kind !== 'db-only-cutover'
    || !sha(audit?.cutoverCommit) || (audit.cutoverCommit !== commit && !descendant)
    || audit?.preservation?.verified !== true || audit?.preservation?.reviewedDifferences !== true
    || audit?.preservation?.missing !== 0 || audit?.preservation?.conflicts !== 0
    || !digest(audit?.preservation?.fileInventoryHash) || !digest(audit?.preservation?.databaseInventoryHash)
    || audit?.restore?.verified !== true || !digest(audit?.restore?.backupHash)) {
    throw new Error('DB-only packaging requires reviewed file preservation parity and verified restore receipt');
  }
}

// Also remove retired helpers from any stale standalone output copied to staging.
const retiredReleasePaths = [
  'data', 'public/logos', 'public/offline',
  'lib/catalog/seed.ts', 'lib/catalog/backfill.ts', 'lib/catalog/logo-import.ts', 'lib/ingestion/publication.ts',
  'scripts/backfill-catalog.ts', 'scripts/backfill-sources.ts', 'scripts/import-reviewed-logos.ts',
  'scripts/fetch-festival-logos.mjs', 'scripts/import-operational-state.ts', 'scripts/audit-file-db-preservation.mjs',
  'scripts/deploy/run-source-backfill.ts', 'scripts/deploy/run-reviewed-logo-import.ts',
];

export async function stripDynamicRelease(root) {
  // Strip legacy migration inputs after separately reviewed preservation/restore proof.
  for (const relative of retiredReleasePaths) {
    await rm(path.join(root, relative), { recursive: true, force: true });
  }
  await assertDynamicReleaseAbsent(root);
}
export async function assertDynamicReleaseAbsent(root) {
  for (const relative of retiredReleasePaths) {
    try { await lstat(path.join(root, relative)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Dynamic catalogue remains in release: ' + relative);
  }
  for (const directory of ['.next/server/app', '.next/standalone']) {
    const files = await readdir(path.join(root, directory), { recursive: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (files.some(file => /(?:festival-playlist-catalog|festivals-2027-v1|ingestion-publications|playlist-status)\.json$/.test(file))) throw new Error('Generated catalogue snapshot remains in release');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [root, commit, auditFile] = process.argv.slice(2);
    if (!root || !auditFile) throw new Error();
    const audit = JSON.parse(await readFile(auditFile, 'utf8'));
    let descendant = false;
    if (/^[a-f0-9]{40}$/.test(audit?.cutoverCommit ?? '') && /^[a-f0-9]{40}$/.test(commit ?? '') && audit.cutoverCommit !== commit) {
      try { execFileSync('git', ['merge-base', '--is-ancestor', audit.cutoverCommit, commit], { stdio: 'ignore' }); descendant = true; }
      catch { /* Unknown/non-ancestor receipts fail closed. */ }
    }
    validateCutoverAudit(audit, commit, descendant);
    await stripDynamicRelease(root);
  } catch { console.error('DB-only release preparation rejected; preservation/restore receipt or archive validation failed'); process.exitCode = 1; }
}
