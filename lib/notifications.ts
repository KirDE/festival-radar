import { NotificationChannel, NotificationEventType, NotificationFrequency, NotificationStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const eventTypes = Object.values(NotificationEventType);
export const channels = Object.values(NotificationChannel);
export const frequencies = Object.values(NotificationFrequency);
export type DetectedChange = { dedupeKey: string; festivalId: string; type: NotificationEventType; title: string; message: string; url?: string; occurredAt: Date; payload?: Prisma.InputJsonValue };

const nextDigest = (frequency: NotificationFrequency) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + (frequency === NotificationFrequency.DAILY ? 1 : 7)); date.setUTCHours(8, 0, 0, 0); return date; };

export async function recordChange(change: DetectedChange) {
  const event = await db.notificationEvent.upsert({ where: { dedupeKey: change.dedupeKey }, update: {}, create: change });
  const preferences = await db.notificationPreference.findMany({ where: { enabled: true, eventType: change.type, OR: [{ festivalId: change.festivalId }, { festivalId: null }] } });
  await db.notificationDelivery.createMany({ data: preferences.map((p) => ({ eventId: event.id, userId: p.userId, channel: p.channel, frequency: p.frequency, nextAttemptAt: p.frequency === NotificationFrequency.IMMEDIATE ? new Date() : nextDigest(p.frequency) })), skipDuplicates: true });
  return event;
}

async function send(channel: NotificationChannel, endpoint: string, title: string, message: string, url?: string) {
  if (channel === NotificationChannel.EMAIL) {
    if (!process.env.EMAIL_WEBHOOK_URL) throw new Error("Email provider is not configured");
    return fetch(process.env.EMAIL_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: endpoint, subject: title, text: `${message}${url ? `\n${url}` : ""}` }) });
  }
  if (channel === NotificationChannel.TELEGRAM) {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram provider is not configured");
    return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: endpoint, text: `${title}\n${message}${url ? `\n${url}` : ""}` }) });
  }
  if (!process.env.WEB_PUSH_WEBHOOK_URL) throw new Error("Web push provider is not configured");
  return fetch(process.env.WEB_PUSH_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint, title, body: message, url }) });
}

export async function dispatchDue(frequency?: NotificationFrequency, limit = 100) {
  const deliveries = await db.notificationDelivery.findMany({ where: { status: NotificationStatus.PENDING, nextAttemptAt: { lte: new Date() }, ...(frequency ? { frequency } : {}) }, include: { event: true, user: { select: { email: true, notificationSubscriptions: { where: { enabled: true } } } } }, orderBy: { createdAt: "asc" }, take: Math.min(limit, 500) });
  const results: { id: string; status: string }[] = [];
  for (const delivery of deliveries) {
    const subscription = delivery.user.notificationSubscriptions.find((item) => item.channel === delivery.channel);
    const endpoint = delivery.channel === NotificationChannel.EMAIL ? delivery.user.email : subscription?.endpoint;
    if (!endpoint) { await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: NotificationStatus.SKIPPED, lastError: "No active channel subscription" } }); results.push({ id: delivery.id, status: "skipped" }); continue; }
    try {
      const response = await send(delivery.channel, endpoint, delivery.event.title, delivery.event.message, delivery.event.url ?? undefined);
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: NotificationStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, lastError: null } }); results.push({ id: delivery.id, status: "sent" });
    } catch (cause) {
      const attempts = delivery.attempts + 1;
      await db.notificationDelivery.update({ where: { id: delivery.id }, data: { attempts, status: attempts >= 5 ? NotificationStatus.FAILED : NotificationStatus.PENDING, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 3_600_000)), lastError: cause instanceof Error ? cause.message.slice(0, 500) : "Delivery failed" } }); results.push({ id: delivery.id, status: attempts >= 5 ? "failed" : "retry" });
    }
  }
  return results;
}
