import type { PrismaClient } from "@prisma/client";

type ClaimOptions = { owner: string; now: Date; limit: number; ttlMs: number };
type LeaseIdentity = { id: string; owner: string; updatedAt: Date };
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


/** Extend only expiry, never updatedAt: that revision fences operator edits and publication. */
export async function renewSourceLease(db: PrismaClient, lease: LeaseIdentity, ttlMs: number): Promise<boolean> {
  validateOwner(lease.owner);
  validateNow(lease.updatedAt);
  if (!lease.id || !Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 30 * 60_000) throw new Error("Invalid ingestion lease renewal");
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "FestivalSource"
    SET "leaseExpiresAt" = clock_timestamp() + (${ttlMs}::int * interval '1 millisecond')
    WHERE id = ${lease.id} AND "leaseOwner" = ${lease.owner}
      AND "updatedAt" = ${lease.updatedAt} AND "leaseExpiresAt" > clock_timestamp()
      AND enabled = true AND "configurationBackfilledAt" IS NOT NULL
      AND "festivalId" IS NOT NULL AND "editionId" IS NOT NULL
      AND "parserKey" IS NOT NULL AND "cadenceSeconds" > 0
    RETURNING id
  `;
  return rows.length === 1;
}

/** A failed/missed heartbeat fails closed; no timer can revive an expired lease. */
export function startSourceLeaseRenewal(
  db: PrismaClient, lease: LeaseIdentity,
  { intervalMs = 5 * 60_000, ttlMs = 30 * 60_000, maxLifetimeMs = 2 * 60 * 60_000 } = {},
) {
  if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 30 * 60_000 ||
      !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs >= ttlMs / 2 ||
      !Number.isInteger(maxLifetimeMs) || maxLifetimeMs < ttlMs) throw new Error("Invalid ingestion lease heartbeat");
  const deadline = Date.now() + maxLifetimeMs;
  let stopped = false;
  let lost = false;
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (stopped || lost || pending) return;
    if (Date.now() >= deadline) { lost = true; return; }
    pending = renewSourceLease(db, lease, ttlMs).then((active) => { if (!active) lost = true; }, () => { lost = true; })
      .finally(() => { pending = undefined; });
  }, intervalMs);
  return {
    assertActive() {
      if (lost || Date.now() >= deadline) throw new Error("Ingestion source lease renewal failed or lifetime exceeded");
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (pending) await pending;
      if (lost || Date.now() >= deadline) throw new Error("Ingestion source lease renewal failed or lifetime exceeded");
    },
  };
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
