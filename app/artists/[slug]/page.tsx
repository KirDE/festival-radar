import { notFound } from "next/navigation";
import { ArtistDetail } from "@/components/ArtistDetail";
import { getCatalog } from "@/lib/catalog/repository";

export const dynamicParams = false;
export async function generateStaticParams() {
  const { artists } = await getCatalog();
  return artists.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { artists } = await getCatalog();
  const requestedSlug = (await params).slug;
  const artist = artists.find(({ slug }) => slug === requestedSlug);
  return artist ? { title: artist.name, alternates: { canonical: `/artists/${artist.slug}/` } } : {};
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const { artists, festivals } = await getCatalog();
  const artist = artists.find((item) => item.slug === slug);
  if (!artist) notFound();
  const appearances = festivals.filter((festival) => [...festival.headliners, ...festival.lineup].includes(artist.name));
  return <ArtistDetail artist={artist} appearances={appearances}/>;
}
import type { Metadata } from "next";
