import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { channels, eventTypes, frequencies } from "@/lib/notifications";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
const preference = z.object({ festivalId: z.string().min(1).nullable().optional(), eventType: z.enum(eventTypes), channel: z.enum(channels), frequency: z.enum(frequencies), enabled: z.boolean().default(true) });
const removal = z.object({ id: z.string().min(1) });
export async function GET() { const user = await requireUser(); if (!user) return error("Authentication required.", 401); return Response.json({ preferences: await db.notificationPreference.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }) }); }
export async function PUT(request: Request) {
  const originError = rejectUntrustedOrigin(request); if (originError) return originError;
  const user = await requireUser(); if (!user) return error("Authentication required.", 401);
  const parsed = preference.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid notification preference.");
  const festivalId = parsed.data.festivalId ?? null;
  const saved = await db.$transaction(async (tx) => {
    const lockKey = [user.id, festivalId ?? "<global>", parsed.data.eventType, parsed.data.channel].join(":");
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const existing = await tx.notificationPreference.findFirst({ where: { userId: user.id, festivalId, eventType: parsed.data.eventType, channel: parsed.data.channel } });
    return existing
      ? tx.notificationPreference.update({ where: { id: existing.id }, data: { frequency: parsed.data.frequency, enabled: parsed.data.enabled } })
      : tx.notificationPreference.create({ data: { userId: user.id, festivalId, ...parsed.data } });
  });
  return Response.json({ preference: saved });
}
export async function DELETE(request: Request) {
  const originError = rejectUntrustedOrigin(request); if (originError) return originError;
  const user = await requireUser(); if (!user) return error("Authentication required.", 401);
  const parsed = removal.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid preference id.");
  const removed = await db.notificationPreference.deleteMany({ where: { id: parsed.data.id, userId: user.id } });
  if (!removed.count) return error("Preference not found.", 404);
  return Response.json({ deleted: true });
}
