import { notFound } from "next/navigation";
import { ArtistDetail } from "@/components/ArtistDetail";
import { allArtists, artistSlug, festivals } from "@/data/festivals";

export const dynamicParams = false;
export function generateStaticParams() { return allArtists.map((name) => ({ slug: artistSlug(name) })); }

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const name = allArtists.find((artist) => artistSlug(artist) === slug);
  if (!name) notFound();
  const appearances = festivals.filter((festival) => [...festival.headliners, ...festival.lineup].includes(name));
  return <ArtistDetail name={name} appearances={appearances}/>;
}
