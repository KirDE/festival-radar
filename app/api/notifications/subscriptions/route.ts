import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { channels } from "@/lib/notifications";
const subscription = z.object({ channel: z.enum(channels), endpoint: z.string().min(1).max(2048), metadata: z.json().optional(), enabled: z.boolean().default(true) });
const removal = z.object({ id: z.string().min(1) });
export async function GET() { const user = await requireUser(); if (!user) return error("Authentication required.", 401); return Response.json({ subscriptions: await db.notificationSubscription.findMany({ where: { userId: user.id } }) }); }
export async function PUT(request: Request) { const user = await requireUser(); if (!user) return error("Authentication required.", 401); const parsed = subscription.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid notification subscription."); const metadata = parsed.data.metadata as Prisma.InputJsonValue | undefined; const saved = await db.notificationSubscription.upsert({ where: { userId_channel_endpoint: { userId: user.id, channel: parsed.data.channel, endpoint: parsed.data.endpoint } }, update: { enabled: parsed.data.enabled, metadata }, create: { userId: user.id, channel: parsed.data.channel, endpoint: parsed.data.endpoint, enabled: parsed.data.enabled, metadata } }); return Response.json({ subscription: saved }); }
export async function DELETE(request: Request) { const user = await requireUser(); if (!user) return error("Authentication required.", 401); const parsed = removal.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid subscription id."); const removed = await db.notificationSubscription.deleteMany({ where: { id: parsed.data.id, userId: user.id } }); if (!removed.count) return error("Subscription not found.", 404); return Response.json({ deleted: true }); }
