import { Prisma } from "@prisma/client";
import { z } from "zod";
import { error } from "@/lib/api";
import { eventTypes, recordChange } from "@/lib/notifications";
const change = z.object({ dedupeKey: z.string().min(1).max(200), festivalId: z.string().min(1), type: z.enum(eventTypes), title: z.string().min(1), message: z.string().min(1), url: z.string().url().optional(), occurredAt: z.coerce.date(), payload: z.json().optional() });
export async function POST(request: Request) { if (!process.env.INTERNAL_API_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INTERNAL_API_SECRET}`) return error("Unauthorized.", 401); const parsed = change.safeParse(await request.json().catch(() => null)); if (!parsed.success) return error("Invalid festival change event."); const payload = parsed.data.payload as Prisma.InputJsonValue | undefined; return Response.json({ event: await recordChange({ ...parsed.data, payload }) }, { status: 202 }); }
