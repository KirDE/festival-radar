import { z } from "zod";
import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { channels, eventTypes, frequencies } from "@/lib/notifications";
const preference = z.object({ festivalId: z.string().min(1).nullable().optional(), eventType: z.enum(eventTypes), channel: z.enum(channels), frequency: z.enum(frequencies), enabled: z.boolean().default(true) });
export async function GET() { const user = await requireUser(); if (!user) return error("Authentication required.", 401); return Response.json({ preferences: await db.notificationPreference.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }) }); }
export async function PUT(request: Request) {
  const user = await requireUser(); if (!user) return error("Authentication required.", 401);
  const parsed = preference.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid notification preference.");
  const festivalId = parsed.data.festivalId ?? null;
  const existing = await db.notificationPreference.findFirst({ where: { userId: user.id, festivalId, eventType: parsed.data.eventType, channel: parsed.data.channel } });
  const saved = existing ? await db.notificationPreference.update({ where: { id: existing.id }, data: { frequency: parsed.data.frequency, enabled: parsed.data.enabled } }) : await db.notificationPreference.create({ data: { userId: user.id, festivalId, ...parsed.data } });
  return Response.json({ preference: saved });
}
