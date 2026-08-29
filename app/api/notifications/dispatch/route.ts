import { z } from "zod";
import { error } from "@/lib/api";
import { dispatchDue, frequencies } from "@/lib/notifications";
const input = z.object({ frequency: z.enum(frequencies).optional(), limit: z.number().int().positive().max(500).default(100) });
export async function POST(request: Request) { if (!process.env.INTERNAL_API_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INTERNAL_API_SECRET}`) return error("Unauthorized.", 401); const parsed = input.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return error("Invalid dispatch request."); const results = await dispatchDue(parsed.data.frequency, parsed.data.limit); return Response.json({ processed: results.length, results }); }
