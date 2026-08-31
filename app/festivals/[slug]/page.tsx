import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FestivalDetail } from "@/components/FestivalDetail";
import { festivals, getFestival } from "@/data/festivals";
import { canonicalPath, festivalMusicEvent } from "@/lib/seo";

export const dynamicParams = false;
export function generateStaticParams() { return festivals.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const festival = getFestival((await params).slug);
  return festival ? { title: festival.name, description: `${festival.name} 2027: dates, lineup, tickets, playlist and setlists.`, alternates: { canonical: canonicalPath(`/festivals/${festival.slug}`) } } : {};
}

export default async function FestivalPage({ params }: { params: Promise<{ slug: string }> }) {
  const item = getFestival((await params).slug);
  if (!item) notFound();
  const event = festivalMusicEvent(item);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }}/><FestivalDetail item={item}/></>;
}
