import type { Prisma, PrismaClient } from '@prisma/client';

type Database = PrismaClient | Prisma.TransactionClient;
export type ImportEvent = { kind: 'source'; sourceId: string; attemptId: string } | { kind: 'repair'; repairId: string };
export async function queueImportEvent(db: Database, identity: string, event: ImportEvent, notBefore = new Date()) {
  // Called inside the transaction that persists the failed/reviewed attempt or repair.
  // A replay cannot reset an already delivered event.
  await db.operationalState.upsert({ where: { key: 'import-event-' + identity },
    create: { key: 'import-event-' + identity, payload: { ...event, status: 'pending', notBefore: notBefore.toISOString() } }, update: {} });
}
