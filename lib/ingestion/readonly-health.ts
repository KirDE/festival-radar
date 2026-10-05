import type { PrismaClient } from '@prisma/client';
import { dueWorkerHealth } from './due-health.ts';

// Dormant diagnostic only: no global client, writes, claims or notification calls.
const fields = [
  'due', 'queueLaggedOverHour', 'active', 'expired', 'error',
  'outboxPending', 'outboxLaggedOverHour', 'unknownParserKeys',
  'playlistPending', 'playlistRunning', 'playlistSucceeded', 'playlistFailed',
  'playlistLaggedOverHour', 'playlistExpired', 'playlistUnleasedRunning',
  'playlistRetryDue', 'playlistDormantFailed',
] as const;
export type ReadonlyHealthCounts = Record<typeof fields[number], number>;
type HealthDatabase = Pick<PrismaClient, 'festivalSource' | 'ingestionNotificationOutbox' | 'catalogPlaylistRefresh'>;
const failure = () => new Error('Read-only health unavailable');

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw failure();
  return value;
}

// Pure exact-schema boundary. Copy data properties only; never serialize input.
export function validateReadonlyHealthCounts(input: unknown): ReadonlyHealthCounts {
  try {
    if (!input || typeof input !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw failure();
    const properties = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(properties);
    if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key as typeof fields[number]))) throw failure();
    const result = {} as ReadonlyHealthCounts;
    for (const field of fields) {
      const property = properties[field];
      if (!property || !('value' in property) || !property.enumerable) throw failure();
      result[field] = count(property.value);
    }
    return result;
  } catch { throw failure(); }
}

// Fixed >= 1 thresholds. Normal due/pending/running/succeeded counts alone do
// not request an alert. This is a decision prerequisite, never a sending API.
export function readonlyHealthAlert(input: unknown): 0 | 1 {
  const health = validateReadonlyHealthCounts(input);
  return [
    health.queueLaggedOverHour, health.expired, health.error,
    health.outboxLaggedOverHour, health.unknownParserKeys,
    health.playlistLaggedOverHour, health.playlistExpired,
    health.playlistUnleasedRunning, health.playlistFailed,
  ].some(value => value >= 1) ? 1 : 0;
}

export async function readonlyDueHealth(db: HealthDatabase, now: Date): Promise<ReadonlyHealthCounts> {
  try {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw failure();
    const clock = new Date(now.getTime());
    const hourAgo = new Date(clock.getTime() - 3_600_000);
    if (!Number.isFinite(hourAgo.getTime())) throw failure();
    // Validate every existing query result, including counts for valid parser
    // groups that dueWorkerHealth otherwise discards. Its final sum is checked
    // again below for safe-integer overflow. Only these read delegates exist.
    const reader = {
      festivalSource: {
        count: async (query: Parameters<PrismaClient['festivalSource']['count']>[0]) => count(await db.festivalSource.count(query)),
        groupBy: async (query: Parameters<PrismaClient['festivalSource']['groupBy']>[0]) => {
          const rows = await db.festivalSource.groupBy(query);
          if (!Array.isArray(rows)) throw failure();
          for (const row of rows) {
            if (!row._count || typeof row._count !== 'object') throw failure();
            count(row._count._all);
          }
          return rows;
        },
      },
      ingestionNotificationOutbox: {
        count: async (query: Parameters<PrismaClient['ingestionNotificationOutbox']['count']>[0]) => count(await db.ingestionNotificationOutbox.count(query)),
      },
    };
    const playlistCount = async (where: NonNullable<Parameters<PrismaClient['catalogPlaylistRefresh']['count']>[0]>['where']) =>
      count(await db.catalogPlaylistRefresh.count({ where }));
    const [due, pending, running, succeeded, failed, lagged, expired, unleased, retryDue, dormantFailed] = await Promise.all([
      dueWorkerHealth(reader as unknown as PrismaClient, clock),
      playlistCount({ status: 'PENDING' }),
      playlistCount({ status: 'RUNNING' }),
      playlistCount({ status: 'SUCCEEDED' }),
      playlistCount({ status: 'FAILED' }),
      playlistCount({ status: { in: ['PENDING', 'RUNNING', 'FAILED'] }, requestedAt: { lte: hourAgo } }),
      playlistCount({ status: 'RUNNING', leaseOwner: { not: null }, leaseExpiresAt: { lte: clock } }),
      playlistCount({ status: 'RUNNING', OR: [{ leaseOwner: null }, { leaseExpiresAt: null }] }),
      playlistCount({ status: 'FAILED', retryAt: { lte: clock } }),
      playlistCount({ status: 'FAILED', retryAt: null }),
    ]);
    return validateReadonlyHealthCounts({ ...due,
      playlistPending: pending, playlistRunning: running, playlistSucceeded: succeeded, playlistFailed: failed,
      playlistLaggedOverHour: lagged, playlistExpired: expired, playlistUnleasedRunning: unleased,
      playlistRetryDue: retryDue, playlistDormantFailed: dormantFailed,
    });
  } catch { throw failure(); }
}
