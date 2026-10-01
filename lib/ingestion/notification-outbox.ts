import { Prisma, type PrismaClient, NotificationEventType } from "@prisma/client";
import { recordChange, type DetectedChange } from "../notifications.ts";

// Event, delivery fan-out and acknowledgement share one database commit.
export async function drainIngestionNotificationOutbox(client: PrismaClient, options: {
  limit?: number;
  afterRecord?: () => Promise<void>; // transaction-failure injection for E2E
} = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid outbox limit");
  let delivered = 0;
  for (let index = 0; index < limit; index++) {
    const processed = await client.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string; dedupeKey: string; event: unknown }>>`
        SELECT id, "dedupeKey", event FROM "IngestionNotificationOutbox"
        WHERE "deliveredAt" IS NULL
        ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      if (!row) return false;
      const event = row.event as Partial<DetectedChange> & { occurredAt?: string };
      if (event.dedupeKey !== row.dedupeKey || typeof event.dedupeKey !== "string" || typeof event.festivalId !== "string" ||
        !Object.values(NotificationEventType).includes(event.type as NotificationEventType) ||
        typeof event.title !== "string" || typeof event.message !== "string" ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))) {
        throw new Error("Invalid staged notification event");
      }
      await recordChange({ ...event, occurredAt: new Date(event.occurredAt) } as DetectedChange, tx);
      await options.afterRecord?.();
      await tx.ingestionNotificationOutbox.update({ where: { id: row.id }, data: { deliveredAt: new Date() } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!processed) break;
    delivered++;
  }
  return delivered;
}
