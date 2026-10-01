import { Prisma, type PrismaClient } from "@prisma/client";

// This module is deliberately not wired to the existing HTTP playlist route or
// scheduler. A later cutover must fence *all* playlist-side effects, retire
// the legacy route, serialize jobs for the same festival, and reconcile old
// RUNNING rows with no lease before invoking a DB-backed worker.
type Claim = { id: string; publicationId: string; festivalSlug: string; attempts: number; leaseOwner: string; leaseExpiresAt: Date };

function validate(owner: string, now: Date, ttlMs: number) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner)) throw new Error("Invalid playlist lease owner");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid playlist lease time");
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 3_600_000) throw new Error("Invalid playlist lease duration");
}

// The publication is the dedupe key: repeated enqueue is a no-op. Publication
// and initial queue row are normally inserted in one transaction by publication.ts.
export async function enqueuePlaylistRefresh(db: PrismaClient, publicationId: string) {
  const publication = await db.catalogPublication.findUnique({ where: { id: publicationId }, select: { festivalSlug: true, lineupChanged: true } });
  if (!publication?.lineupChanged) throw new Error("Playlist queue requires a lineup publication");
  await db.catalogPlaylistRefresh.createMany({ data: [{ publicationId, festivalSlug: publication.festivalSlug }], skipDuplicates: true });
  return db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { publicationId } });
}

// Read a bounded page of distinct festivals before taking any advisory locks.
// Filtering with pg_try_advisory_xact_lock before ORDER BY/LIMIT could lock
// every eligible festival, so only call it for one chosen festival at a time.
// The optional hook is used to synchronize transaction-boundary E2E tests.
export async function claimPlaylistRefresh(
  db: PrismaClient,
  input: { owner: string; now: Date; ttlMs: number },
  afterFestivalLock?: (festivalSlug: string) => Promise<void>,
): Promise<Claim | null> {
  validate(input.owner, input.now, input.ttlMs);
  const expiry = new Date(input.now.getTime() + input.ttlMs);
  return db.$transaction(async (tx) => {
    let cursor: { requestedAt: Date; id: string } | null = null;
    for (;;) {
      // DISTINCT ON runs before keyset pagination: even thousands of jobs
      // for the oldest festival use just one of the 32 candidate slots.
      const after: Prisma.Sql = cursor
        ? Prisma.sql`WHERE (candidate."requestedAt", candidate.id) > (${cursor.requestedAt}, ${cursor.id})`
        : Prisma.empty;
      const candidates: { id: string; festivalSlug: string; requestedAt: Date }[] = await tx.$queryRaw`
        SELECT candidate.id, candidate."festivalSlug", candidate."requestedAt"
        FROM (
          SELECT DISTINCT ON (job."festivalSlug") job.id, job."festivalSlug", job."requestedAt"
          FROM "CatalogPlaylistRefresh" AS job
          WHERE (job.status = 'PENDING'
            OR (job.status = 'FAILED' AND job."retryAt" <= ${input.now})
            OR (job.status = 'RUNNING' AND job."leaseExpiresAt" <= ${input.now}))
            AND NOT EXISTS (
              SELECT 1 FROM "CatalogPlaylistRefresh" AS sibling
              WHERE sibling."festivalSlug" = job."festivalSlug"
                AND sibling.id <> job.id AND sibling.status = 'RUNNING'
            )
          ORDER BY job."festivalSlug", job."requestedAt", job.id
        ) AS candidate
        ${after}
        ORDER BY candidate."requestedAt", candidate.id
        LIMIT 32
      `;
      if (!candidates.length) return null;
      for (const candidate of candidates) {
        cursor = { requestedAt: candidate.requestedAt, id: candidate.id };
        const [{ acquired }] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(210, hashtext(${candidate.festivalSlug})) AS acquired
        `;
        if (!acquired) continue;
        await afterFestivalLock?.(candidate.festivalSlug);
        // New READ COMMITTED statement snapshot after the festival lock.
        // The row lock guards UPDATE; any RUNNING sibling (even expired or
        // unleased legacy rows) blocks another job in the same festival.
        const jobs = await tx.$queryRaw<{ id: string }[]>`
          SELECT job.id FROM "CatalogPlaylistRefresh" AS job
          WHERE job."festivalSlug" = ${candidate.festivalSlug}
            AND (job.status = 'PENDING'
              OR (job.status = 'FAILED' AND job."retryAt" <= ${input.now})
              OR (job.status = 'RUNNING' AND job."leaseExpiresAt" <= ${input.now}))
            AND NOT EXISTS (
              SELECT 1 FROM "CatalogPlaylistRefresh" AS sibling
              WHERE sibling."festivalSlug" = job."festivalSlug"
                AND sibling.id <> job.id AND sibling.status = 'RUNNING'
            )
          ORDER BY job."requestedAt", job.id
          LIMIT 1 FOR UPDATE OF job SKIP LOCKED
        `;
        if (!jobs.length) continue;
        const rows = await tx.$queryRaw<Claim[]>`
          UPDATE "CatalogPlaylistRefresh" AS job
            SET status = 'RUNNING', attempts = job.attempts + 1,
                "leaseOwner" = ${input.owner}, "leaseExpiresAt" = ${expiry},
                "startedAt" = ${input.now}, "completedAt" = NULL, "retryAt" = NULL,
                "lastError" = NULL, "updatedAt" = ${input.now}
          WHERE job.id = ${jobs[0].id}
          RETURNING job.id, job."publicationId", job."festivalSlug", job.attempts,
                    job."leaseOwner", job."leaseExpiresAt"
        `;
        return rows[0] ?? null;
      }
      if (candidates.length < 32) return null;
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function finishPlaylistRefresh(db: PrismaClient, claim: Claim, now: Date, outcome: "SUCCEEDED" | "FAILED") {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid playlist completion time");
  // Failed attempts cannot hot-loop: bounded exponential retry. Legacy FAILED
  // rows without retryAt stay dormant until explicitly reconciled at cutover.
  const retryDelayMs = Math.min(86_400_000, 60_000 * 2 ** Math.min(11, Math.max(0, claim.attempts - 1)));
  const result = await db.catalogPlaylistRefresh.updateMany({
    where: { id: claim.id, status: "RUNNING", leaseOwner: claim.leaseOwner,
      attempts: claim.attempts, leaseExpiresAt: { gt: now } },
    data: { status: outcome, completedAt: now, leaseOwner: null, leaseExpiresAt: null,
      retryAt: outcome === "FAILED" ? new Date(now.getTime() + retryDelayMs) : null },
  });
  return result.count === 1;
}
