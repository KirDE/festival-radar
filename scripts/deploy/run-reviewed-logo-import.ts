// Manual production entrypoint. Keep stdout audit-only, including disconnect failure.
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PINNED_REVIEWED_DIGEST, applyReviewedLogos, auditReviewedLogos, inventoryDigest, previewReviewedLogos, verifyReviewedLogos } from '../../lib/catalog/logo-import.ts';

export const REVIEWED_DIGEST = PINNED_REVIEWED_DIGEST;
export type Mode = 'preview' | 'verify' | 'apply';
type Status = 'ok' | 'source-rejected' | 'database-rejected' | 'disconnect-error' | 'write-rejected' | 'post-commit-verify-failed';
export function validNonce(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
export function audit(mode: Mode, nonce: string, status: Status, existing?: number) {
  if (!validNonce(nonce) || !['preview', 'verify', 'apply'].includes(mode) ||
      !['ok', 'source-rejected', 'database-rejected', 'disconnect-error', 'write-rejected', 'post-commit-verify-failed'].includes(status) ||
      (mode !== 'apply' && ['write-rejected', 'post-commit-verify-failed'].includes(status)) ||
      (status === 'ok' ? !Number.isSafeInteger(existing) || existing! < 0 || existing! > 47 ||
        (mode === 'verify' && existing !== 47) || (mode === 'apply' && existing !== 0 && existing !== 47) : existing !== undefined)) {
    throw new Error('Invalid logo audit');
  }
  return JSON.stringify({ operation: 'reviewed-logo-import', mode, nonce, status,
    inventoryDigest: REVIEWED_DIGEST, sourceFiles: 47,
    ...(status === 'ok' ? mode === 'apply' ? { preExisting: existing, inserted: 47 - existing!, postVerified: 47 } : { existing } : {}) });
}

export async function runLogoImport(db: PrismaClient, mode: Mode, nonce: string, expectedExisting?: number) {
  if (!validNonce(nonce)) throw new Error('Invalid logo operation nonce');
  if (!['preview', 'verify', 'apply'].includes(mode) ||
      (mode === 'apply' && expectedExisting !== 0 && expectedExisting !== 47)) throw new Error('Invalid logo operation mode or count');
  let rows;
  try {
    rows = await auditReviewedLogos();
    if (rows.length !== 47 || inventoryDigest(rows) !== REVIEWED_DIGEST) throw new Error('Unreviewed logo inventory');
  } catch { return { ok: false, output: audit(mode, nonce, 'source-rejected') }; }
  try {
    if (mode === 'preview') {
      const result = await previewReviewedLogos(db, rows);
      return { ok: true, output: audit(mode, nonce, 'ok', result.existingBindings) };
    }
    if (mode === 'verify') {
      const result = await verifyReviewedLogos(db, rows);
      return { ok: true, output: audit(mode, nonce, 'ok', result.bound) };
    }
    // Fresh read-only preview; repeated under table locks immediately before insert.
    const preview = await previewReviewedLogos(db, rows);
    if (preview.existingBindings !== expectedExisting || inventoryDigest(rows) !== REVIEWED_DIGEST) {
      return { ok: false, output: audit(mode, nonce, 'write-rejected') };
    }
    try { await applyReviewedLogos(db, rows, expectedExisting); }
    catch { return { ok: false, output: audit(mode, nonce, 'write-rejected') }; }
  } catch { return { ok: false, output: audit(mode, nonce, 'database-rejected') }; }
  // Commit has happened. Never label a failed read-back as a rolled-back import.
  try {
    await verifyReviewedLogos(db, rows);
    return { ok: true, output: audit(mode, nonce, 'ok', expectedExisting) };
  } catch { return { ok: false, output: audit(mode, nonce, 'post-commit-verify-failed') }; }
}

function isMainModule() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isMainModule()) {
  const args = process.argv.slice(2);
  const mode = args.length === 1 && ['preview', 'verify', 'apply'].includes(args[0]) ? args[0] as Mode : null;
  const nonce = process.env.LOGO_IMPORT_NONCE;
  const commit = process.env.LOGO_IMPORT_COMMIT;
  let releaseMatches = false;
  try { releaseMatches = readFileSync(new URL('../../DEPLOYED_COMMIT', import.meta.url), 'utf8') === commit + '\n'; } catch { /* fixed guard below */ }
  const expected = process.env.LOGO_IMPORT_EXPECTED_EXISTING;
  if (!mode || !validNonce(nonce) || !process.env.DATABASE_URL ||
      !/^[0-9a-f]{40}$/.test(commit ?? '') || process.env.DEPLOYED_COMMIT !== commit || !releaseMatches ||
      (mode === 'apply' && (process.env.LOGO_IMPORT_CONFIRMATION !== 'APPLY-47-' + commit ||
        !/^[0-9a-f]{64}$/.test(process.env.LOGO_IMPORT_PROOF_DIGEST ?? '') || !['0', '47'].includes(expected ?? '')))) {
    console.error('logo operation guard rejected');
    process.exitCode = 1;
  } else {
    let db: PrismaClient | undefined;
    let result;
    try {
      db = new PrismaClient({ log: [] });
      result = await runLogoImport(db, mode, nonce!, mode === 'apply' ? Number(expected) : undefined);
    }
    catch { result = { ok: false, output: audit(mode, nonce!, 'database-rejected') }; }
    try { await db?.$disconnect(); }
    catch { result = { ok: false, output: audit(mode, nonce!, 'disconnect-error') }; }
    console.log('LOGO_IMPORT_AUDIT ' + result.output);
    if (!result.ok) process.exitCode = 1;
  }
}
