import { festivals } from "@/data/festivals";
import { auditEntries, parserRuns, reviewChanges } from "@/lib/admin";
import { requireAdminActor } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function GET() {
  const auth = await requireAdminActor();
  if (auth.response) return auth.response;
  const persistedAudit = await db.adminAuditEntry.findMany({
    orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { email: true } } },
  });
  return Response.json({
    actor: { email: auth.actor.email, role: auth.actor.role }, festivals, reviewChanges, parserRuns,
    auditEntries: [
      ...persistedAudit.map((entry) => ({ id: entry.id, at: entry.createdAt.toISOString(), actor: entry.actor.email, action: entry.action, target: entry.target, detail: JSON.stringify(entry.detail ?? {}) })),
      ...auditEntries,
    ],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
