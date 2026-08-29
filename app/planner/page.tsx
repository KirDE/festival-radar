import { PlannerPage } from "@/components/PlannerPage";
import { festivals } from "@/data/festivals";
export const metadata = { title: "My festival plan" };
export default function Planner() {
  return <PlannerPage festivals={festivals} />;
}
