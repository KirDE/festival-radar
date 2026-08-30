import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FestivalDetail } from "@/components/FestivalDetail";
import { festivals, getFestival } from "@/data/festivals";

export const dynamicParams = false;
export function generateStaticParams() { return festivals.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const festival = getFestival((await params).slug);
  return festival ? { title: festival.name, description: `${festival.name} 2027: dates, lineup, tickets, playlist and setlists.` } : {};
}

export default async function FestivalPage({ params }: { params: Promise<{ slug: string }> }) {
  const item = getFestival((await params).slug);
  if (!item) notFound();
  const event = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: item.name,
    startDate: item.startDate,
    endDate: item.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: item.city || item.country, address: { "@type": "PostalAddress", addressCountry: item.countryCode } },
    url: `https://festivals.kir-it.de/festivals/${item.slug}/`,
    sameAs: item.officialUrl,
    ...(item.ticketStatus === "available" && item.ticketsUrl ? { offers: { "@type": "Offer", url: item.ticketsUrl, availability: "https://schema.org/InStock" } } : {}),
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }}/><FestivalDetail item={item}/></>;
}
