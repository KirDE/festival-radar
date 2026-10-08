import { notFound } from "next/navigation";
import { FestivalEditionContent } from "@/components/PublicCatalogPages";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";
export default async function FestivalEditionPage({ params }: { params: Promise<{ slug: string; year: string }> }) {
  const { slug, year: rawYear } = await params;
  const { editions } = await getCatalog();
  const item = editions.find((edition) => edition.slug === slug && edition.editionYear === Number(rawYear));
  if (!item) notFound();
  return <FestivalEditionContent item={item} />;
}
