import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export async function claimOperationalState(db: PrismaClient, key: string) {
  if (!/^[a-z][a-z0-9-]{1,80}$/.test(key)) throw new Error('Invalid operational key');
  const owner = randomUUID();
  await db.$executeRaw`INSERT INTO "OperationalState" (key, payload) VALUES (${key}, '{}'::jsonb) ON CONFLICT (key) DO NOTHING`;
  const rows = await db.$queryRaw<{ payload: unknown }[]>`
    UPDATE "OperationalState" SET "leaseOwner" = ${owner}, "leaseExpiresAt" = (clock_timestamp() AT TIME ZONE 'UTC') + interval '2 hours'
    WHERE key = ${key} AND ("leaseOwner" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) RETURNING payload`;
  if (rows.length !== 1) throw new Error('Operational task already running');
  return {
    payload: rows[0].payload,
    async save(value: unknown) {
      const count = await db.$executeRaw`UPDATE "OperationalState" SET payload = ${JSON.stringify(value)}::jsonb, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
        WHERE key = ${key} AND "leaseOwner" = ${owner} AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
      if (count !== 1) throw new Error('Operational state lease lost');
    },
    async release() {
      await db.$executeRaw`UPDATE "OperationalState" SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE key = ${key} AND "leaseOwner" = ${owner}`;
    },
  };
}
