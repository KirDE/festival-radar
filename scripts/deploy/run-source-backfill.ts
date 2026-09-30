// Fixed-mode operator entry point. Never print URLs, database errors, or configuration.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { festivalSources } from "../../data/festival-sources.ts";
import { backfillSources, SourceBackfillReject, policyCode, strategyMask, MAX_CONFLICT_DIGEST, type LegacyConfigConflictSummary, type SourceBackfillRejectCode, type SourceBackfillReport } from "../../lib/sources/repository.ts";

export const migration = "20260930190000_source_configuration_foundation";

export function validNonce(nonce: string | undefined): nonce is string {
  return typeof nonce === "string" && /^[0-9a-f]{64}$/.test(nonce);
}

type Mode = "preview" | "apply" | "verify";
type AuditStatus = "ok" | "review-required" | "migration-missing" | "migration-check-error" | "database-or-unknown-error" | "guard-or-data-error" | "disconnect-error" | SourceBackfillRejectCode;
const errorStatuses = new Set<AuditStatus>(["migration-missing", "migration-check-error", "database-or-unknown-error", "guard-or-data-error", "disconnect-error", "seed-validation", "duplicate-source", "missing-enabled-festival", "missing-edition", "binding-conflict", "legacy-config-conflict", "unresolved-drift"]);

export function audit(mode: Mode, status: AuditStatus, nonce: string, counts?: { insert: number; fill: number; preserve: number }, drift?: number, conflictSummary?: LegacyConfigConflictSummary) {
  if (!validNonce(nonce)) throw new Error("invalid source operation nonce");
  if (!["preview", "apply", "verify"].includes(mode) || !(["ok", "review-required"].includes(status) || errorStatuses.has(status))) throw new Error("invalid source operation audit");
  const validCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  if (errorStatuses.has(status) ? counts !== undefined || drift !== undefined : !counts || !validCount(drift) || Object.values(counts).some((value) => !validCount(value))) throw new Error("invalid source operation audit shape");
  if (status === "legacy-config-conflict" ? !conflictSummary || !validCount(conflictSummary.affectedRows) || conflictSummary.affectedRows === 0 ||
    !validCount(conflictSummary.editionYear) || !validCount(conflictSummary.refreshPolicy) || !validCount(conflictSummary.strategies) ||
    [conflictSummary.editionYear, conflictSummary.refreshPolicy, conflictSummary.strategies].some((value) => value > conflictSummary.affectedRows) ||
    conflictSummary.editionYear + conflictSummary.refreshPolicy + conflictSummary.strategies < conflictSummary.affectedRows ||
    !Array.isArray(conflictSummary.digest) || conflictSummary.digest.length !== conflictSummary.affectedRows || conflictSummary.digest.length > MAX_CONFLICT_DIGEST ||
    !conflictSummary.digest.every((tuple, position) => Array.isArray(tuple) && tuple.length === 4 &&
      tuple.every((value) => Number.isSafeInteger(value)) && tuple[0] >= 0 && tuple[0] < festivalSources.length &&
      (position === 0 || tuple[0] > conflictSummary.digest[position - 1][0]) &&
      tuple[1] >= -2147483648 && tuple[1] <= 2147483647 && tuple[2] >= 0 && tuple[2] <= 4 && tuple[3] >= 0 && tuple[3] <= 31) ||
    conflictSummary.digest.filter(([index, year]) => year !== festivalSources[index].editionYear).length !== conflictSummary.editionYear ||
    conflictSummary.digest.filter(([index, , policy]) => policy !== policyCode(festivalSources[index].refreshPolicy)).length !== conflictSummary.refreshPolicy ||
    // Mask omits ordering; the planner still counts order-only mismatches.
    conflictSummary.digest.filter(([index, , , mask]) => mask !== strategyMask(festivalSources[index].strategies)).length > conflictSummary.strategies
    : conflictSummary !== undefined) throw new Error("invalid source operation audit shape");
  return JSON.stringify({ operation: "festival-source-backfill", mode, nonce, status, ...(counts ? { counts } : {}),
    ...(conflictSummary ? { conflictSummary: { affectedRows: conflictSummary.affectedRows, editionYear: conflictSummary.editionYear, refreshPolicy: conflictSummary.refreshPolicy, strategies: conflictSummary.strategies, digest: conflictSummary.digest.map(([index, year, policy, mask]) => [index, year, policy, mask]) } } : {}),
    drift: errorStatuses.has(status) ? null : drift });
}

export async function migrationApplied(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    WHERE migration_name = ${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return rows.length === 1 && Number(rows[0].count) === 1;
}

export async function runSourceBackfill(db: PrismaClient, mode: Mode, nonce: string) {
  if (!validNonce(nonce)) throw new Error("invalid source operation nonce");
  let migrated: boolean;
  try { migrated = await migrationApplied(db); }
  catch { return { ok: false, output: audit(mode, "migration-check-error", nonce) }; }
  if (!migrated) return { ok: false, output: audit(mode, "migration-missing", nonce) };
  let report: SourceBackfillReport;
  try { report = await backfillSources(db, festivalSources, { dryRun: mode !== "apply", failOnDrift: true, reconcileKnownLegacy: true }); }
  catch (error) {
    // Never serialize exception text, including Prisma's SQL and source URLs.
    const status = error instanceof SourceBackfillReject && errorStatuses.has(error.code) ? error.code : "database-or-unknown-error";
    return { ok: false, output: audit(mode, status, nonce, undefined, undefined,
      status === "legacy-config-conflict" && error instanceof SourceBackfillReject ? error.conflictSummary : undefined) };
  }
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
