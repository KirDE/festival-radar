import { AdminConsole } from "@/components/AdminConsole";
import { festivals } from "@/data/festivals";
import { auditEntries, parserRuns, reviewChanges } from "@/lib/admin";

export const metadata = { title: "Administration | Festival Radar" };

export default function AdminPage() {
  return <AdminConsole festivals={festivals} initialChanges={reviewChanges} parserRuns={parserRuns} auditEntries={auditEntries} />;
}
