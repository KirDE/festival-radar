import { AdminConsole } from "@/components/AdminConsole";
import { festivals } from "@/data/festivals";
import { currentAdmin } from "@/lib/admin-access";
import { adminSnapshot } from "@/lib/admin-store";
import { redirect } from "next/navigation";

export const metadata = { title: "Administration | Festival Radar" };

export default async function AdminPage() {
  if (!await currentAdmin()) redirect("/?admin=forbidden");
  const snapshot = await adminSnapshot();
  return <AdminConsole submissions={snapshot.submissions.map((item) => ({ reference:item.publicReference,name:item.name,year:item.editionYear,officialUrl:item.officialUrl,notes:item.notes,status:item.status.toLowerCase() as "pending"|"approved"|"rejected",submittedAt:item.submittedAt.toISOString(),audit:item.audit.map((entry)=>({action:entry.action,at:entry.createdAt.toISOString()})) }))} festivals={festivals} initialChanges={snapshot.changes.map((item) => ({ id: item.id, festival: item.resourceKey, field: item.field, current: JSON.stringify(item.beforeValue), detected: JSON.stringify(item.afterValue), source: JSON.stringify(item.sourceEvidence), confidence: item.confidence ?? 0, status: item.status.toLowerCase() as "pending" | "approved" | "rejected", conflict: item.status === "CONFLICT" }))} parserRuns={snapshot.runs.map((item) => ({ festival: item.festivalSlug, source: item.adapter, status: item.status === "SUCCEEDED" ? "healthy" : item.status === "FAILED" ? "failed" : "warning", lastRun: item.startedAt.toISOString(), durationMs: item.durationMs ?? 0, extracted: item.extracted, message: item.message ?? "Running" }))} auditEntries={snapshot.audit.map((item) => ({ id: item.id, at: item.createdAt.toISOString(), actor: item.actorLabel, action: item.action, target: item.resourceKey ?? "system", detail: JSON.stringify(item.metadata ?? {}) }))} />;
}
