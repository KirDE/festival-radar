import type { PrismaClient } from "@prisma/client";

// This module is deliberately not wired to the existing HTTP playlist route or
// scheduler. A later cutover must fence *all* playlist-side effects and retire
// the legacy route before invoking a DB-backed worker.
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

// SKIP LOCKED and an atomic UPDATE guarantee a single owner per publication.
// A claim's attempts revision fences stale owners, including same-owner reuse.
export async function claimPlaylistRefresh(db: PrismaClient, input: { owner: string; now: Date; ttlMs: number }): Promise<Claim | null> {
  validate(input.owner, input.now, input.ttlMs);
  const expiry = new Date(input.now.getTime() + input.ttlMs);
  const rows = await db.$queryRaw<Claim[]>`
    WITH candidate AS (
      SELECT id FROM "CatalogPlaylistRefresh"
      WHERE status IN ('PENDING', 'FAILED')
        OR (status = 'RUNNING' AND "leaseExpiresAt" <= ${input.now})
      ORDER BY "requestedAt", id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE "CatalogPlaylistRefresh" AS job
      SET status = 'RUNNING', attempts = job.attempts + 1,
          "leaseOwner" = ${input.owner}, "leaseExpiresAt" = ${expiry},
          "startedAt" = ${input.now}, "completedAt" = NULL,
          "lastError" = NULL, "updatedAt" = ${input.now}
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.id, job."publicationId", job."festivalSlug", job.attempts,
              job."leaseOwner", job."leaseExpiresAt"
  `;
  return rows[0] ?? null;
}

export async function finishPlaylistRefresh(db: PrismaClient, claim: Claim, now: Date, outcome: "SUCCEEDED" | "FAILED") {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid playlist completion time");
  const result = await db.catalogPlaylistRefresh.updateMany({
    where: { id: claim.id, status: "RUNNING", leaseOwner: claim.leaseOwner,
      attempts: claim.attempts, leaseExpiresAt: { gt: now } },
    data: { status: outcome, completedAt: now, leaseOwner: null, leaseExpiresAt: null },
  });
  return result.count === 1;
}
