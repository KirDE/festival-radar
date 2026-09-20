import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FestivalDetail } from "@/components/FestivalDetail";
import { getCatalog } from "@/lib/catalog/repository";
import { canonicalPath, festivalMusicEvent } from "@/lib/seo";

export const dynamicParams = false;
export async function generateStaticParams() {
  const { festivals } = await getCatalog();
  return festivals.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { festivals } = await getCatalog();
  const requestedSlug = (await params).slug;
  const festival = festivals.find(({ slug }) => slug === requestedSlug);
  return festival ? { title: festival.name, description: `${festival.name} 2027: dates, lineup, tickets, playlist and setlists.`, alternates: { canonical: canonicalPath(`/festivals/${festival.slug}`) } } : {};
}

export default async function FestivalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { festivals, playlists } = await getCatalog();
  const requestedSlug = (await params).slug;
  const item = festivals.find(({ slug }) => slug === requestedSlug);
  if (!item) notFound();
  const event = festivalMusicEvent(item);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }}/><FestivalDetail item={item} playlist={playlists[item.slug]}/></>;
}
