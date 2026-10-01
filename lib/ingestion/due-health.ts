import type { PrismaClient } from '@prisma/client';
import { sourceParserKey } from '../sources/repository.ts';

// Aggregate only; never expose source identifiers, URLs, parser keys, errors or event payloads.
// A parser key is valid only for this row's slug and ordered strategy list,
// as in mapSource. Inventory membership alone does not validate a DB row.

export async function dueWorkerHealth(db: PrismaClient, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid health clock');
  const hourAgo = new Date(now.getTime() - 60 * 60_000);
  const eligible = { enabled: true, configurationBackfilledAt: { not: null }, festivalId: { not: null }, editionId: { not: null }, parserKey: { not: null }, cadenceSeconds: { gt: 0 } } as const;
  const [due, queueLagged, active, expired, error, pending, lagged, parserKeys] = await Promise.all([
    db.festivalSource.count({ where: { ...eligible, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }], AND: [{ OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }] } }),
    db.festivalSource.count({ where: { ...eligible, nextRunAt: { lte: hourAgo }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] } }),
    db.festivalSource.count({ where: { ...eligible, leaseOwner: { not: null }, leaseExpiresAt: { gt: now } } }),
    db.festivalSource.count({ where: { ...eligible, leaseOwner: { not: null }, leaseExpiresAt: { lte: now } } }),
    db.festivalSource.count({ where: { enabled: true, consecutiveFailures: { gt: 0 } } }),
    db.ingestionNotificationOutbox.count({ where: { deliveredAt: null } }),
    db.ingestionNotificationOutbox.count({ where: { deliveredAt: null, createdAt: { lte: hourAgo } } }),
    db.festivalSource.groupBy({ by: ['festivalSlug', 'strategies', 'parserKey'], where: { enabled: true }, _count: { _all: true } }),
  ]);
  const unknownParserKeys = parserKeys.reduce((sum, row) => {
    let valid = false;
    try {
      valid = !!row.parserKey &&
        sourceParserKey({ festivalSlug: row.festivalSlug, strategies: row.strategies as Parameters<typeof sourceParserKey>[0]['strategies'] }) === row.parserKey;
    } catch { /* invalid strategy or festival/adapter pairing */ }
    return sum + (valid ? 0 : row._count._all);
  }, 0);
  return { due, queueLaggedOverHour: queueLagged, active, expired, error, outboxPending: pending, outboxLaggedOverHour: lagged, unknownParserKeys };
}
