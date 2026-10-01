import { PrismaClient } from '@prisma/client';
import { auditReviewedLogos, applyReviewedLogos, inventoryDigest, previewReviewedLogos, verifyReviewedLogos } from '../lib/catalog/logo-import.ts';
import { festivalLogoFallbacks } from '../data/festival-logos.ts';
import { festivals } from '../data/festivals.ts';

const args = process.argv.slice(2);
const mode = args[0];
if (!['--dry-run', '--verify', '--apply'].includes(mode) || args.filter(a => ['--dry-run', '--verify', '--apply'].includes(a)).length !== 1) {
  throw new Error('Usage: tsx scripts/import-reviewed-logos.ts --dry-run|--verify|--apply [--confirm-disposable=DB_NAME --expected-digest=SHA256]');
}
const options = args.slice(1);
if (options.some(arg => !/^--(?:confirm-disposable|expected-digest)=[a-zA-Z0-9_-]+$/.test(arg)) || new Set(options.map(arg => arg.split('=')[0])).size !== options.length) {
  throw new Error('Unexpected or repeated import option');
}
const rows = await auditReviewedLogos();
const digest = inventoryDigest(rows);
const report = { sourceFiles: rows.length, festivals: festivals.length, fallback: [...festivalLogoFallbacks].sort(),
  bytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
  mime: { 'image/png': rows.filter(row => row.mimeType === 'image/png').length,
    'image/jpeg': rows.filter(row => row.mimeType === 'image/jpeg').length,
    'image/webp': rows.filter(row => row.mimeType === 'image/webp').length },
  distinctHashes: new Set(rows.map(row => row.sha256)).size, inventoryDigest: digest,
  files: rows.map(({ slug, file, mimeType, sizeBytes, sha256 }) => ({ slug, file, mimeType, sizeBytes, sha256 })) };
console.log(JSON.stringify({ mode, report }, null, 2));

// Offline source audit is useful without any database access. --verify and --apply require an explicit DB.
if (mode === '--dry-run' && !process.env.DATABASE_URL) process.exit(0);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for DB comparison');
const target = new URL(process.env.DATABASE_URL);
const name = decodeURIComponent(target.pathname.slice(1));
const localDisposable = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
  && /(?:test|integration)/i.test(name) && !target.searchParams.has('host');
if (mode === '--apply' && (!localDisposable || options.length !== 2 ||
    !options.includes('--confirm-disposable=' + name) || !options.includes('--expected-digest=' + digest))) {
  throw new Error('Apply requires local disposable test/integration database and exact DB name + inventory digest confirmation');
}
if (mode !== '--apply' && options.length) throw new Error('Confirmation options only valid with --apply');
const db = new PrismaClient();
try {
  if (mode === '--verify') console.log(JSON.stringify({ verified: await verifyReviewedLogos(db, rows) }));
  else if (mode === '--apply') {
    console.log(JSON.stringify({ applied: await applyReviewedLogos(db, rows) }));
    console.log(JSON.stringify({ verified: await verifyReviewedLogos(db, rows) }));
  } else {
    console.log(JSON.stringify({ preview: await previewReviewedLogos(db, rows) }));
  }
} finally { await db.$disconnect(); }
