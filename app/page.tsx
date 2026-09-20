import { HomeContent } from "@/components/HomeContent";
import { getCatalog } from "@/lib/catalog/repository";

export default async function Home() {
  const { festivals } = await getCatalog();
  return <HomeContent festivals={festivals} />;
}
