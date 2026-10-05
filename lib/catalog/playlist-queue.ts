import { Prisma, type PrismaClient } from "@prisma/client";

// This module is deliberately not wired to the existing HTTP playlist route or
// scheduler. A later cutover must fence *all* playlist-side effects, retire
// the legacy route, serialize jobs for the same festival, and reconcile old
// RUNNING rows with no lease before invoking a DB-backed worker.
export type PlaylistLease = { id: string; publicationId: string; festivalSlug: string; attempts: number; leaseOwner: string; leaseExpiresAt: Date };
export type PlaylistClaimCursor = { requestedAt: Date; id: string };
export type PlaylistClaimPage = { claim: PlaylistLease; nextCursor: null } | { claim: null; nextCursor: PlaylistClaimCursor | null };
const CLAIM_PAGE_SIZE = 16;

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

// Each call examines at most one page in one transaction. On contention,
// pass nextCursor to the next call. Null nextCursor means the scan is exhausted;
// start again from the beginning on the next poll or after a successful claim.
// This is a scan position, not a durable queue offset: changes behind it are
// found on the next poll. No loop spans multiple pages inside Prisma's tx.
// Read a bounded page of distinct festivals before taking any advisory locks.
// Filtering with pg_try_advisory_xact_lock before ORDER BY/LIMIT could lock
// every eligible festival, so only call it for one chosen festival at a time.
// The optional hook is used to synchronize transaction-boundary E2E tests.
export async function claimPlaylistRefresh(
  db: PrismaClient,
  input: { owner: string; now: Date; ttlMs: number; cursor?: PlaylistClaimCursor | null },
  afterFestivalLock?: (festivalSlug: string) => Promise<void>,
): Promise<PlaylistClaimPage> {
  validate(input.owner, input.now, input.ttlMs);
  if (input.cursor && (!(input.cursor.requestedAt instanceof Date) || !Number.isFinite(input.cursor.requestedAt.getTime())
    || typeof input.cursor.id !== "string" || !/^[a-z0-9]{20,40}$/.test(input.cursor.id))) {
    throw new Error("Invalid playlist claim cursor");
  }
  const expiry = new Date(input.now.getTime() + input.ttlMs);
  return db.$transaction(async (tx) => {
    let cursor = input.cursor ?? null;
    // DISTINCT ON runs before keyset pagination: even thousands of jobs
    // for the oldest festival use just one of the 16 candidate slots.
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
          OR (job.status = 'RUNNING' AND job."leaseOwner" IS NOT NULL AND job."leaseExpiresAt" <= ${input.now}))
          AND NOT EXISTS (
            SELECT 1 FROM "CatalogPlaylistRefresh" AS sibling
            WHERE sibling."festivalSlug" = job."festivalSlug"
              AND sibling.id <> job.id AND sibling.status = 'RUNNING'
          )
        ORDER BY job."festivalSlug", job."requestedAt", job.id
      ) AS candidate
      ${after}
      ORDER BY candidate."requestedAt", candidate.id
      LIMIT ${CLAIM_PAGE_SIZE}
    `;
    if (!candidates.length) return { claim: null, nextCursor: null };
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
            OR (job.status = 'RUNNING' AND job."leaseOwner" IS NOT NULL AND job."leaseExpiresAt" <= ${input.now}))
          AND NOT EXISTS (
            SELECT 1 FROM "CatalogPlaylistRefresh" AS sibling
            WHERE sibling."festivalSlug" = job."festivalSlug"
              AND sibling.id <> job.id AND sibling.status = 'RUNNING'
          )
        ORDER BY job."requestedAt", job.id
        LIMIT 1 FOR UPDATE OF job SKIP LOCKED
      `;
      if (!jobs.length) continue;
      const rows = await tx.$queryRaw<PlaylistLease[]>`
        UPDATE "CatalogPlaylistRefresh" AS job
          SET status = 'RUNNING', attempts = job.attempts + 1,
              "leaseOwner" = ${input.owner}, "leaseExpiresAt" = ${expiry},
              "startedAt" = ${input.now}, "completedAt" = NULL, "retryAt" = NULL,
              "lastError" = NULL, "updatedAt" = ${input.now}
        WHERE job.id = ${jobs[0].id}
        RETURNING job.id, job."publicationId", job."festivalSlug", job.attempts,
                  job."leaseOwner", job."leaseExpiresAt"
      `;
      if (rows[0]) return { claim: rows[0], nextCursor: null };
    }
    return { claim: null, nextCursor: candidates.length === CLAIM_PAGE_SIZE ? cursor : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export class PlaylistLeaseLostError extends Error {
  constructor() { super("Playlist lease is no longer active"); this.name = "PlaylistLeaseLostError"; }
}

function validateLease(claim: PlaylistLease) {
  validate(claim.leaseOwner, claim.leaseExpiresAt, 1_000);
  if (!claim.id || !claim.publicationId || !claim.festivalSlug || !Number.isSafeInteger(claim.attempts) || claim.attempts < 1) {
    throw new Error("Invalid playlist lease identity");
  }
}

// Lock in the same order as claim: festival, then job. Check DB time in a
// separate statement AFTER acquiring the row lock (including any lock wait).
async function lockPlaylistLease(tx: Prisma.TransactionClient, claim: PlaylistLease) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(210, hashtext(${claim.festivalSlug}))`;
  await tx.$queryRaw`SELECT id FROM "CatalogPlaylistRefresh" WHERE id = ${claim.id} FOR UPDATE`;
  await requirePlaylistLease(tx, claim);
}

async function requirePlaylistLease(tx: Prisma.TransactionClient, claim: PlaylistLease, now?: Date) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT job.id FROM "CatalogPlaylistRefresh" AS job
    JOIN "CatalogPublication" AS publication ON publication.id = job."publicationId"
    WHERE job.id = ${claim.id} AND job."publicationId" = ${claim.publicationId}
      AND job."festivalSlug" = ${claim.festivalSlug}
      AND publication."festivalSlug" = ${claim.festivalSlug} AND publication."lineupChanged" = true
      AND job.status = 'RUNNING' AND job."leaseOwner" = ${claim.leaseOwner}
      AND job.attempts = ${claim.attempts}
      AND job."leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      ${now ? Prisma.sql`AND job."leaseExpiresAt" > (${now}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM "CatalogPlaylistRefresh" AS sibling
        WHERE sibling."festivalSlug" = job."festivalSlug" AND sibling.id <> job.id AND sibling.status = 'RUNNING'
      )
  `;
  if (rows.length !== 1) throw new PlaylistLeaseLostError();
}

// For the check immediately before an external call. The lock ends on return;
// this cannot revoke a Spotify call in flight or guarantee exactly-once effects.
export async function assertPlaylistRefreshLease(db: PrismaClient, claim: PlaylistLease): Promise<void> {
  validateLease(claim);
  await db.$transaction((tx) => lockPlaylistLease(tx, claim), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

// Trusted DB-only callback: use ONLY tx and scope for this publication's
// catalog playlist writes. No external calls or queue mutations inside it.
// All writes roll back if ownership/expiry fails, including after the callback.
export async function commitPlaylistRefresh<T>(
  db: PrismaClient, claim: PlaylistLease,
  write: (tx: Prisma.TransactionClient, scope: { festivalSlug: string; editionYear: number; publicationId: string }) => Promise<T>,
): Promise<T> {
  validateLease(claim);
  return db.$transaction(async (tx) => {
    await lockPlaylistLease(tx, claim);
    const publication = await tx.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId }, select: { editionYear: true } });
    const result = await write(tx, { festivalSlug: claim.festivalSlug, editionYear: publication.editionYear, publicationId: claim.publicationId });
    await requirePlaylistLease(tx, claim);
    const count = await tx.$executeRaw`
      UPDATE "CatalogPlaylistRefresh" SET status = 'SUCCEEDED', "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
        "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "retryAt" = NULL
      WHERE id = ${claim.id}
        AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
    `;
    if (count !== 1) throw new PlaylistLeaseLostError();
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function finishPlaylistRefresh(db: PrismaClient, claim: PlaylistLease, now: Date, outcome: "SUCCEEDED" | "FAILED") {
  validateLease(claim);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid playlist completion time");
  // Failed attempts cannot hot-loop. Caller time can tighten expiry, never
  // bypass DB time; retain it for the existing retry/completion contract.
  const retryDelayMs = Math.min(86_400_000, 60_000 * 2 ** Math.min(11, Math.max(0, claim.attempts - 1)));
  try {
    return await db.$transaction(async (tx) => {
      await lockPlaylistLease(tx, claim);
      await requirePlaylistLease(tx, claim, now);
      const count = await tx.$executeRaw`
        UPDATE "CatalogPlaylistRefresh" SET status = ${outcome}::"CatalogPlaylistRefreshStatus",
          "completedAt" = ${now}, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
          "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
          "retryAt" = ${outcome === "FAILED" ? new Date(now.getTime() + retryDelayMs) : null}
        WHERE id = ${claim.id} AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      `;
      if (count !== 1) throw new PlaylistLeaseLostError();
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof PlaylistLeaseLostError) return false;
    throw error;
  }
}
