import { PrismaClient } from "@prisma/client";
import { backfillCatalog, verifyCatalogParity } from "../lib/catalog/backfill.ts";
import { catalogSeed } from "../lib/catalog/seed.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const db = new PrismaClient();
try {
  const report = process.argv.includes("--verify-only")
    ? await verifyCatalogParity(db, catalogSeed)
    : await backfillCatalog(db, catalogSeed);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
