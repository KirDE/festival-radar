import { PlannerPage } from "@/components/PlannerPage";
import { getCatalog } from "@/lib/catalog/repository";
export const metadata = { title: "My festival plan" };
export default async function Planner() {
  const { festivals } = await getCatalog();
  return <PlannerPage festivals={festivals} />;
}
