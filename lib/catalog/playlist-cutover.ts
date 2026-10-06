import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export type PlaylistMode = 'legacy' | 'database';
export function playlistMode(payload: unknown): PlaylistMode {
  if (payload === undefined || payload === null) return 'legacy';
  const value = payload as Record<string, unknown>;
  if (value.version !== 1 || value.mode !== 'database' || value.reconciled !== true || value.legacyDrained !== true
    || !/^[a-f0-9]{40}$/.test(String(value.commit ?? '')) || !/^[a-f0-9]{64}$/.test(String(value.queueHash ?? ''))) {
    throw new Error('Invalid playlist activation record');
  }
  return 'database';
}
export async function readPlaylistMode(db: PrismaClient): Promise<PlaylistMode> {
  const rows = await db.$queryRaw<{ payload: unknown }[]>`SELECT payload FROM "OperationalState" WHERE key = 'playlist-cutover'`;
  return playlistMode(rows[0]?.payload);
}
export type QueueInventory = { id: string; publicationId: string; festivalSlug: string; status: string; attempts: number; leaseOwner: string | null; leaseExpiresAt: Date | null; retryAt: Date | null };
export function queueActivationAudit(rows: QueueInventory[]) {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const blocked = sorted.filter(row => row.status === 'RUNNING' || row.leaseOwner !== null || row.leaseExpiresAt !== null || (row.status === 'FAILED' && row.retryAt === null)).length;
  return { reconciled: blocked === 0, blocked, count: rows.length, hash: createHash('sha256').update(JSON.stringify(sorted)).digest('hex') };
}
