// Fixed-mode operator entry point. Never print URLs, database errors, or configuration.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { festivalSources } from "../../data/festival-sources.ts";
import { backfillSources } from "../../lib/sources/repository.ts";

export const migration = "20260930190000_source_configuration_foundation";

export function validNonce(nonce: string | undefined): nonce is string {
  return typeof nonce === "string" && /^[0-9a-f]{64}$/.test(nonce);
}

export function audit(mode: string, status: string, nonce: string, counts?: { insert: number; fill: number; preserve: number }, drift = 0) {
  if (!validNonce(nonce)) throw new Error("invalid source operation nonce");
  return JSON.stringify({ operation: "festival-source-backfill", mode, nonce, status, ...(counts ? { counts } : {}), drift });
}

export async function migrationApplied(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    WHERE migration_name = ${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return rows.length === 1 && Number(rows[0].count) === 1;
}

export async function runSourceBackfill(db: PrismaClient, mode: "preview" | "apply" | "verify", nonce: string) {
  if (!validNonce(nonce)) throw new Error("invalid source operation nonce");
  if (!await migrationApplied(db)) return { ok: false, output: audit(mode, "migration-missing", nonce) };
  const report = await backfillSources(db, festivalSources, { dryRun: mode !== "apply", failOnDrift: true });
  const drift = report.plan.filter((item) => item.drift.length).length;
  const ok = report.ok && (mode !== "verify" || (report.counts.insert === 0 && report.counts.fill === 0));
  return { ok, output: audit(mode, ok ? "ok" : "review-required", nonce, report.counts, drift) };
}

// Resolve both paths: systemd executes through current -> releases/<sha>.
// A missing entry path must not make an imported module start the operation.
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Imported by tests without starting a process or connecting to any database.
if (isMainModule()) {
  const args = process.argv.slice(2);
  const mode = args.length === 1 && ["preview", "apply", "verify"].includes(args[0]) ? args[0] as "preview" | "apply" | "verify" : null;
  const nonce = process.env.SOURCE_BACKFILL_NONCE;
  if (!mode || !process.env.DATABASE_URL || !/^[0-9a-f]{40}$/.test(process.env.DEPLOYED_COMMIT ?? "") || !validNonce(nonce)) {
    // No accepted audit can exist without a validated one-time nonce.
    console.error("source operation guard rejected");
    process.exitCode = 1;
  } else {
    const db = new PrismaClient();
    try {
      const result = await runSourceBackfill(db, mode, nonce);
      console.log("SOURCE_BACKFILL_AUDIT " + result.output);
      if (!result.ok) process.exitCode = 1;
    } catch {
      // Prisma errors and source URLs may contain protected data; never emit them.
      console.log("SOURCE_BACKFILL_AUDIT " + audit(mode, "guard-or-data-error", nonce));
      process.exitCode = 1;
    } finally { try { await db.$disconnect(); } catch { console.log("SOURCE_BACKFILL_AUDIT " + audit(mode, "disconnect-error", nonce)); process.exitCode = 1; } }
  }
}
