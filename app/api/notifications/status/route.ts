import { z } from "zod";
import { NotificationChannel, NotificationFrequency, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";

const requestSchema = z.object({ channel: z.nativeEnum(NotificationChannel) });

export async function GET() {
  const user = await requireUser(); if (!user) return error("Authentication required.", 401);
  const [subscriptions, recent] = await Promise.all([
    db.notificationSubscription.findMany({ where: { userId: user.id }, select: { id: true, channel: true, endpoint: true, enabled: true, updatedAt: true } }),
    db.notificationDelivery.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: { channel: true, status: true, attempts: true, sentAt: true, updatedAt: true, lastError: true } }),
  ]);
  return Response.json({
    subscriptions: subscriptions.map((item) => ({ ...item, endpoint: item.channel === NotificationChannel.EMAIL ? "account email" : item.channel === NotificationChannel.TELEGRAM ? `chat …${item.endpoint.slice(-4)}` : "browser subscription" })),
    recent,
    providers: {
      EMAIL: Boolean(process.env.EMAIL_WEBHOOK_URL), TELEGRAM: Boolean(process.env.TELEGRAM_BOT_TOKEN), WEB_PUSH: Boolean(process.env.WEB_PUSH_WEBHOOK_URL),
    },
    webPushPublicKey: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_KEY || null,
  });
}

export async function POST(request: Request) {
  const user = await requireUser(); if (!user) return error("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid channel.");
  if (parsed.data.channel !== NotificationChannel.EMAIL) {
    const enrolled = await db.notificationSubscription.findFirst({ where: { userId: user.id, channel: parsed.data.channel, enabled: true } });
    if (!enrolled) return error("Enroll and enable this channel before sending a test.", 409);
  }
  const event = await db.notificationEvent.create({ data: { dedupeKey: `user-test:${user.id}:${parsed.data.channel}:${Date.now()}`, festivalId: "notification-test", type: "TIMETABLE_PUBLISHED", title: "Festival Radar test", message: "Your notification channel is connected.", occurredAt: new Date() } });
  const delivery = await db.notificationDelivery.create({ data: { eventId: event.id, userId: user.id, channel: parsed.data.channel, frequency: NotificationFrequency.IMMEDIATE, status: NotificationStatus.PENDING, nextAttemptAt: new Date() } });
  return Response.json({ queued: true, deliveryId: delivery.id }, { status: 202 });
}
