import { HomeContent } from "@/components/HomeContent";
import { festivals } from "@/data/festivals";

export default function Home() {
  return <HomeContent festivals={festivals} />;
}
