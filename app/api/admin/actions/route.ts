import { z } from "zod";
import { requireAdminActor, rejectUntrustedOrigin } from "@/lib/admin-auth";
import { error } from "@/lib/api";
import { db } from "@/lib/db";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review.decide"), target: z.string().min(1).max(100), decision: z.enum(["approved", "rejected"]) }),
  z.object({ action: z.literal("festival.save-draft"), target: z.string().min(1).max(100) }),
  z.object({ action: z.literal("festival.refresh"), target: z.string().min(1).max(100) }),
]);

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Invalid administrative action.", 400);
  const allowed = parsed.data.action === "festival.refresh" ? ["ADMIN"] as const : ["EDITOR", "ADMIN"] as const;
  const auth = await requireAdminActor(allowed);
  if (auth.response) return auth.response;
  const entry = await db.adminAuditEntry.create({ data: {
    actorId: auth.actor.id, action: parsed.data.action, target: parsed.data.target,
    detail: "decision" in parsed.data ? { decision: parsed.data.decision } : undefined,
  } });
  return Response.json({ accepted: true, auditId: entry.id }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
