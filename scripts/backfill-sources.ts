import { PrismaClient } from "@prisma/client";
import { festivalSources } from "../data/festival-sources.ts";
import { backfillSources } from "../lib/sources/repository.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const args = process.argv.slice(2);
if (args.some((arg) => !["--preview", "--verify-only", "--apply"].includes(arg)) || args.filter((arg) => arg === "--apply").length > 1) throw new Error("Usage: backfill-sources [--preview|--verify-only|--apply]");
const apply = args.includes("--apply");
if (apply && args.some((arg) => arg !== "--apply")) throw new Error("Choose only one mode");
const db = new PrismaClient();
try {
  const report = await backfillSources(db, festivalSources, { dryRun: !apply });
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", ...report }, null, 2));
  if (!report.ok || (args.includes("--verify-only") && (report.counts.insert || report.counts.fill))) process.exitCode = 1;
} finally { await db.$disconnect(); }
