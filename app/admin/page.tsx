import { AdminConsole } from "@/components/AdminConsole";
import { festivals } from "@/data/festivals";
import { auditEntries, parserRuns, reviewChanges } from "@/lib/admin";
import { currentUser } from "@/lib/auth";
import { forbidden, redirect } from "next/navigation";

export const metadata = { title: "Administration | Festival Radar" };

export default async function AdminPage() {
  const actor = await currentUser();
  if (!actor) redirect("/?login=required&next=/admin");
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") forbidden();
  return <AdminConsole actor={{ email: actor.email, role: actor.role }} festivals={festivals} initialChanges={reviewChanges} parserRuns={parserRuns} auditEntries={auditEntries} />;
}
