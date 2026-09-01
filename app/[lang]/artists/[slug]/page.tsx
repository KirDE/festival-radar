import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Language } from "@/components/LanguageProvider";
import { ArtistDetail } from "@/components/ArtistDetail";
import { artistProfiles, getArtistProfile } from "@/data/artists";
import { festivals, supportedLanguages } from "@/data/festivals";

export const dynamicParams = false;

export function generateStaticParams() {
  return supportedLanguages.flatMap((lang) => artistProfiles.map(({ slug }) => ({ lang, slug })));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const artist = getArtistProfile(slug);
  if (!artist || !supportedLanguages.includes(lang as Language)) return {};
  return {
    title: artist.name,
    alternates: {
      canonical: `/${lang}/artists/${artist.slug}/`,
      languages: {
        "x-default": `/artists/${artist.slug}/`,
        en: `/en/artists/${artist.slug}/`,
        de: `/de/artists/${artist.slug}/`,
        ru: `/ru/artists/${artist.slug}/`,
      },
    },
  };
}

export default async function LocalizedArtistPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!supportedLanguages.includes(lang as Language)) notFound();
  const artist = getArtistProfile(slug);
  if (!artist) notFound();
  const appearances = festivals.filter((festival) => [...festival.headliners, ...festival.lineup].includes(artist.name));
  return <ArtistDetail artist={artist} appearances={appearances} />;
}
