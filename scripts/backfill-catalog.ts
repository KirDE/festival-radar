import { PrismaClient } from '@prisma/client';
import { backfillCatalog, verifyCatalogParity } from '../lib/catalog/backfill.ts';
import { catalogSeed } from '../lib/catalog/seed.ts';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const target = new URL(process.env.DATABASE_URL);
const disposable = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  && /(?:test|integration)/i.test(target.pathname) && !target.searchParams.has('host') && !target.searchParams.has('hostaddr');
// Historical backfill rewrites existing rows. It is a fixture/bootstrap tool,
// never a production importer after DB-owned edits. Production parity is read-only.
if (!process.argv.includes('--verify-only') && !disposable) throw new Error('Catalogue backfill writes require a local disposable test/integration DB');
const db = new PrismaClient();
try {
  const report = process.argv.includes('--verify-only') ? await verifyCatalogParity(db, catalogSeed) : await backfillCatalog(db, catalogSeed);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally { await db.$disconnect(); }
