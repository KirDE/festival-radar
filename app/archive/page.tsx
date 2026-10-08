import { ArchiveContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";
export const dynamic = "force-dynamic";

export const metadata = { title: "Festival archives and future editions", description: "Browse provenance-aware Festival Radar editions.", alternates: { canonical: "/archive/" } };

export default async function ArchivePage() {
  const { editions } = await getCatalog();
  return <ArchiveContent archived={editions.filter(({ recordState }) => recordState === "archived")} future={editions.filter(({ recordState }) => recordState === "tracking")} />;
}
