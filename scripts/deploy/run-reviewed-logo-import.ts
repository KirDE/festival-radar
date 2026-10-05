// Manual production operation: only a root-owned fixed-mode systemd unit invokes this entrypoint.
// No URL, path, festival, or arbitrary command input is accepted. Keep stdout audit-only.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { auditReviewedLogos, inventoryDigest, previewReviewedLogos, verifyReviewedLogos } from '../../lib/catalog/logo-import.ts';

export const REVIEWED_DIGEST = '99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456';
type Mode = 'preview' | 'verify';
type Status = 'ok' | 'source-rejected' | 'database-rejected' | 'disconnect-error';
export function validNonce(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
export function audit(mode: Mode, nonce: string, status: Status, existing?: number) {
  if (!validNonce(nonce) || !['preview', 'verify'].includes(mode) ||
      !['ok', 'source-rejected', 'database-rejected', 'disconnect-error'].includes(status) ||
      (status === 'ok' ? !Number.isSafeInteger(existing) || existing! < 0 || existing! > 47 : existing !== undefined)) {
    throw new Error('Invalid logo audit');
  }
  return JSON.stringify({ operation: 'reviewed-logo-import', mode, nonce, status,
    inventoryDigest: REVIEWED_DIGEST, sourceFiles: 47, ...(status === 'ok' ? { existing } : {}) });
}

export async function runLogoImport(db: PrismaClient, mode: Mode, nonce: string) {
  if (!validNonce(nonce)) throw new Error('Invalid logo operation nonce');
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
    const result = await verifyReviewedLogos(db, rows);
    return { ok: true, output: audit(mode, nonce, 'ok', result.bound) };
  } catch { return { ok: false, output: audit(mode, nonce, 'database-rejected') }; }
}

function isMainModule() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isMainModule()) {
  const args = process.argv.slice(2);
  const mode = args.length === 1 && ['preview', 'verify'].includes(args[0]) ? args[0] as Mode : null;
  const nonce = process.env.LOGO_IMPORT_NONCE;
  if (!mode || !validNonce(nonce) || !process.env.DATABASE_URL ||
      !/^[0-9a-f]{40}$/.test(process.env.DEPLOYED_COMMIT ?? '')) {
    console.error('logo operation guard rejected');
    process.exitCode = 1;
  } else {
    const db = new PrismaClient();
    try {
      const result = await runLogoImport(db, mode, nonce);
      console.log('LOGO_IMPORT_AUDIT ' + result.output);
      if (!result.ok) process.exitCode = 1;
    } catch {
      console.log('LOGO_IMPORT_AUDIT ' + audit(mode, nonce, 'database-rejected'));
      process.exitCode = 1;
    } finally {
      try { await db.$disconnect(); }
      catch { console.log('LOGO_IMPORT_AUDIT ' + audit(mode, nonce, 'disconnect-error')); process.exitCode = 1; }
    }
  }
}
