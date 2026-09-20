import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Language } from "@/components/LanguageProvider";
import { FestivalDetail } from "@/components/FestivalDetail";
import { supportedLanguages } from "@/data/festivals";
import { getCatalog } from "@/lib/catalog/repository";
import { festivalMusicEvent } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const { festivals } = await getCatalog();
  const festival = festivals.find((item) => item.slug === slug);
  if (!festival || !supportedLanguages.includes(lang as Language)) return {};
  return { title: festival.name, alternates: { canonical: `/${lang}/festivals/${festival.slug}/`, languages: { "x-default": `/festivals/${festival.slug}/`, en: `/en/festivals/${festival.slug}/`, de: `/de/festivals/${festival.slug}/`, ru: `/ru/festivals/${festival.slug}/` } } };
}

export default async function LocalizedFestivalPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!supportedLanguages.includes(lang as Language)) notFound();
  const { festivals, playlists } = await getCatalog();
  const item = festivals.find((festival) => festival.slug === slug);
  if (!item) notFound();
  const event = festivalMusicEvent(item);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }} /><FestivalDetail item={item} playlist={playlists[item.slug]} /></>;
}
