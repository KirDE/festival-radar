import { notFound } from "next/navigation";
import { ArtistDetail } from "@/components/ArtistDetail";
import { artistProfiles, getArtistProfile } from "@/data/artists";
import { festivals } from "@/data/festivals";

export const dynamicParams = false;
export function generateStaticParams() { return artistProfiles.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const artist = getArtistProfile((await params).slug);
  return artist ? { title: artist.name, alternates: { canonical: `/artists/${artist.slug}/` } } : {};
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const artist = getArtistProfile(slug);
  if (!artist) notFound();
  const appearances = festivals.filter((festival) => [...festival.headliners, ...festival.lineup].includes(artist.name));
  return <ArtistDetail artist={artist} appearances={appearances}/>;
}
import type { Metadata } from "next";
