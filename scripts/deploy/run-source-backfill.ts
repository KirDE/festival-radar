// Fixed-mode operator entry point. Never print URLs, database errors, or configuration.
import { PrismaClient } from "@prisma/client";
import { festivalSources } from "../../data/festival-sources.ts";
import { backfillSources } from "../../lib/sources/repository.ts";

export const migration = "20260930190000_source_configuration_foundation";

export function audit(mode: string, status: string, counts?: { insert: number; fill: number; preserve: number }, drift = 0) {
  return JSON.stringify({ operation: "festival-source-backfill", mode, status, ...(counts ? { counts } : {}), drift });
}

export async function migrationApplied(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    WHERE migration_name = ${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return rows.length === 1 && Number(rows[0].count) === 1;
}

export async function runSourceBackfill(db: PrismaClient, mode: "preview" | "apply" | "verify") {
  if (!await migrationApplied(db)) return { ok: false, output: audit(mode, "migration-missing") };
  const report = await backfillSources(db, festivalSources, { dryRun: mode !== "apply", failOnDrift: true });
  const drift = report.plan.filter((item) => item.drift.length).length;
  const ok = report.ok && (mode !== "verify" || (report.counts.insert === 0 && report.counts.fill === 0));
  return { ok, output: audit(mode, ok ? "ok" : "review-required", report.counts, drift) };
}

// Imported by tests without starting a process or connecting to any database.
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const args = process.argv.slice(2);
  const mode = args.length === 1 && ["preview", "apply", "verify"].includes(args[0]) ? args[0] as "preview" | "apply" | "verify" : null;
  if (!mode || !process.env.DATABASE_URL || !/^[0-9a-f]{40}$/.test(process.env.DEPLOYED_COMMIT ?? "")) {
    console.log("SOURCE_BACKFILL_AUDIT " + audit(mode ?? "invalid", "guard-rejected"));
    process.exitCode = 1;
  } else {
    const db = new PrismaClient();
    try {
      const result = await runSourceBackfill(db, mode);
      console.log("SOURCE_BACKFILL_AUDIT " + result.output);
      if (!result.ok) process.exitCode = 1;
    } catch {
      // Prisma errors and source URLs may contain protected data; never emit them.
      console.log("SOURCE_BACKFILL_AUDIT " + audit(mode, "guard-or-data-error"));
      process.exitCode = 1;
    } finally { try { await db.$disconnect(); } catch { console.log("SOURCE_BACKFILL_AUDIT " + audit(mode, "disconnect-error")); process.exitCode = 1; } }
  }
}
