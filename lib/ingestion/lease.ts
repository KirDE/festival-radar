import type { PrismaClient } from "@prisma/client";

type ClaimOptions = { owner: string; now: Date; limit: number; ttlMs: number };
type Completion = { id: string; owner: string; now: Date; updatedAt: Date; outcome: "success" | "fetch_error" | "parser_error" };

function validateOwner(owner: string) {
  // Per-run random UUID, never a stable hostname or user-supplied source value.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner)) throw new Error("Invalid ingestion lease owner");
}

function validateNow(now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid ingestion lease time");
}

/** One atomic PostgreSQL statement: no worker may claim the same source while another holds its row lock. */
export async function claimDueSources(db: PrismaClient, { owner, now, limit, ttlMs }: ClaimOptions): Promise<Array<{ id: string; updatedAt: Date }>> {
  validateOwner(owner);
  validateNow(now);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid ingestion batch size");
  if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 30 * 60_000) throw new Error("Invalid ingestion lease duration");
  const expires = new Date(now.getTime() + ttlMs);
  const rows = await db.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
    WITH due AS (
      SELECT id FROM "FestivalSource"
      WHERE enabled = true AND "configurationBackfilledAt" IS NOT NULL
        AND "festivalId" IS NOT NULL AND "editionId" IS NOT NULL
        AND "parserKey" IS NOT NULL AND "cadenceSeconds" > 0
        AND ("nextRunAt" IS NULL OR "nextRunAt" <= ${now})
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
      ORDER BY "nextRunAt" ASC NULLS FIRST, id ASC
      FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "FestivalSource" AS source
    SET "leaseOwner" = ${owner}, "leaseExpiresAt" = ${expires}, "updatedAt" = ${now}
    FROM due WHERE source.id = due.id
    RETURNING source.id, source."updatedAt"
  `;
  return rows;
}

/** Compatibility for existing callers needing just IDs. */
export async function claimDueSourceIds(db: PrismaClient, options: ClaimOptions): Promise<string[]> {
  return (await claimDueSources(db, options)).map(({ id }) => id);
}

/** Fenced acknowledgement; expired/reclaimed work may not advance the schedule or clear a new lease. */
export async function completeSourceLease(db: PrismaClient, { id, owner, now, updatedAt, outcome }: Completion): Promise<boolean> {
  validateOwner(owner);
  validateNow(now);
  validateNow(updatedAt);
  if (!id || !["success", "fetch_error", "parser_error"].includes(outcome)) throw new Error("Invalid ingestion completion");
  const success = outcome === "success";
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "FestivalSource"
    SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
        "lastAttemptAt" = ${now},
        "lastSuccessAt" = CASE WHEN ${success} THEN ${now} ELSE "lastSuccessAt" END,
        "lastError" = CASE WHEN ${success} THEN NULL ELSE ${outcome} END,
        "consecutiveFailures" = CASE WHEN ${success} THEN 0 ELSE "consecutiveFailures" + 1 END,
        "nextRunAt" = CASE WHEN ${success}
          THEN ${now} + make_interval(secs => "cadenceSeconds")
          ELSE ${now} + make_interval(secs => LEAST(86400, 300 * power(2, LEAST("consecutiveFailures", 8)))::int)
        END,
        "updatedAt" = ${now}
    WHERE id = ${id} AND "leaseOwner" = ${owner} AND "leaseExpiresAt" > ${now}
      AND enabled = true AND "configurationBackfilledAt" IS NOT NULL AND "updatedAt" = ${updatedAt}
    RETURNING id
  `;
  return rows.length === 1;
}
