import { readFile } from 'node:fs/promises';
import { db } from '../lib/db.ts';
import { auditDatabasePreservation, canonical } from '../lib/catalog/preservation-audit.ts';
const commit = process.argv.find(value => value.startsWith('--commit='))?.slice(9);
const manifestPath = process.argv.find(value => value.startsWith('--manifest='))?.slice(11);
if (!process.env.DATABASE_URL || !commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('DATABASE_URL and exact --commit required');
try {
  const inventory = await auditDatabasePreservation(db);
  const expected = manifestPath ? JSON.parse(await readFile(manifestPath, 'utf8')).inventory : undefined;
  const verified = expected !== undefined && JSON.stringify(canonical(expected)) === JSON.stringify(canonical(inventory));
  // A DB/restore manifest comparison cannot attest that remaining files were preserved.
  console.log(JSON.stringify({ kind: 'db-only-inventory', commit, inventory, manifestVerified: verified, fileParityVerified: false }));
  if (manifestPath && !verified) process.exitCode = 1;
} catch { console.error('cutover_inventory_audit_failed'); process.exitCode = 1; }
finally { await db.$disconnect(); }
