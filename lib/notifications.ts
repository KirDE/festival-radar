import { NotificationChannel, NotificationEventType, NotificationFrequency, NotificationStatus, Prisma } from "@prisma/client";
import { db } from "./db.ts";
import { nextDigest } from "./notification-schedule.ts";

export const eventTypes = Object.values(NotificationEventType);
export const channels = Object.values(NotificationChannel);
export const frequencies = Object.values(NotificationFrequency);
export type DetectedChange = { dedupeKey: string; festivalId: string; type: NotificationEventType; title: string; message: string; url?: string; occurredAt: Date; payload?: Prisma.InputJsonValue };

export async function recordChange(change: DetectedChange) {
  const event = await db.notificationEvent.upsert({ where: { dedupeKey: change.dedupeKey }, update: {}, create: change });
  const preferences = await db.notificationPreference.findMany({ where: { enabled: true, eventType: change.type, OR: [{ festivalId: change.festivalId }, { festivalId: null }] }, include: { user: { select: { emailVerifiedAt: true } } } });
  const effectivePreferences = new Map<string, (typeof preferences)[number]>();
  for (const preference of preferences) {
    if (preference.channel === NotificationChannel.EMAIL && !preference.user.emailVerifiedAt) continue;
    const key = `${preference.userId}:${preference.channel}`;
    const current = effectivePreferences.get(key);
    if (!current || (current.festivalId === null && preference.festivalId !== null)) effectivePreferences.set(key, preference);
  }
  await db.notificationDelivery.createMany({ data: [...effectivePreferences.values()].map((p) => ({ eventId: event.id, userId: p.userId, channel: p.channel, frequency: p.frequency, nextAttemptAt: p.frequency === NotificationFrequency.IMMEDIATE ? new Date() : nextDigest(p.frequency) })), skipDuplicates: true });
  return event;
}

async function send(deliveryId: string, channel: NotificationChannel, endpoint: string, title: string, message: string, url?: string) {
  const headers = { "content-type": "application/json", "idempotency-key": deliveryId };
  if (channel === NotificationChannel.EMAIL) {
    if (!process.env.EMAIL_WEBHOOK_URL) throw new Error("Email provider is not configured");
    return fetch(process.env.EMAIL_WEBHOOK_URL, { method: "POST", headers, body: JSON.stringify({ deliveryId, to: endpoint, subject: title, text: `${message}${url ? `\n${url}` : ""}` }) });
  }
  if (channel === NotificationChannel.TELEGRAM) {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram provider is not configured");
    return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers, body: JSON.stringify({ chat_id: endpoint, text: `${title}\n${message}${url ? `\n${url}` : ""}` }) });
  }
  if (!process.env.WEB_PUSH_WEBHOOK_URL) throw new Error("Web push provider is not configured");
  return fetch(process.env.WEB_PUSH_WEBHOOK_URL, { method: "POST", headers, body: JSON.stringify({ deliveryId, endpoint, title, body: message, url }) });
}

export async function dispatchDue(frequency?: NotificationFrequency, limit = 100) {
  const claimToken = crypto.randomUUID();
  const boundedLimit = Math.min(limit, 500);
  await db.$executeRaw`
    WITH due AS (
      SELECT id FROM "NotificationDelivery"
      WHERE ((status = 'PENDING' AND "nextAttemptAt" <= NOW()) OR (status = 'CLAIMED' AND "claimedAt" < NOW() - INTERVAL '15 minutes'))
      ${frequency ? Prisma.sql`AND frequency = ${frequency}::"NotificationFrequency"` : Prisma.empty}
      ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT ${boundedLimit}
    )
    UPDATE "NotificationDelivery" AS delivery
    SET status = 'CLAIMED', "claimedAt" = NOW(), "claimToken" = ${claimToken}, "updatedAt" = NOW()
    FROM due WHERE delivery.id = due.id
  `;
  const deliveries = await db.notificationDelivery.findMany({ where: { claimToken, status: NotificationStatus.CLAIMED }, include: { event: true, user: { select: { email: true, emailVerifiedAt: true, notificationSubscriptions: { where: { enabled: true } } } } }, orderBy: { createdAt: "asc" } });
  const results: { id: string; status: string }[] = [];
  for (const delivery of deliveries) {
    if (delivery.channel === NotificationChannel.EMAIL && !delivery.user.emailVerifiedAt) { await db.notificationDelivery.updateMany({ where: { id: delivery.id, claimToken }, data: { status: NotificationStatus.SKIPPED, claimToken: null, claimedAt: null, lastError: "Email address is not verified" } }); results.push({ id: delivery.id, status: "skipped" }); continue; }
    const subscription = delivery.user.notificationSubscriptions.find((item) => item.channel === delivery.channel);
    const endpoint = delivery.channel === NotificationChannel.EMAIL ? delivery.user.email : subscription?.endpoint;
    if (!endpoint) { await db.notificationDelivery.updateMany({ where: { id: delivery.id, claimToken }, data: { status: NotificationStatus.SKIPPED, claimToken: null, claimedAt: null, lastError: "No active channel subscription" } }); results.push({ id: delivery.id, status: "skipped" }); continue; }
    try {
      const response = await send(delivery.id, delivery.channel, endpoint, delivery.event.title, delivery.event.message, delivery.event.url ?? undefined);
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      await db.notificationDelivery.updateMany({ where: { id: delivery.id, claimToken }, data: { status: NotificationStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, claimToken: null, claimedAt: null, lastError: null } }); results.push({ id: delivery.id, status: "sent" });
    } catch (cause) {
      const attempts = delivery.attempts + 1;
      await db.notificationDelivery.updateMany({ where: { id: delivery.id, claimToken }, data: { attempts, status: attempts >= 5 ? NotificationStatus.FAILED : NotificationStatus.PENDING, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 3_600_000)), claimToken: null, claimedAt: null, lastError: cause instanceof Error ? cause.message.slice(0, 500) : "Delivery failed" } }); results.push({ id: delivery.id, status: attempts >= 5 ? "failed" : "retry" });
    }
  }
  return results;
}
