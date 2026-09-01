import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Language } from "@/components/LanguageProvider";
import { FestivalDetail } from "@/components/FestivalDetail";
import { festivals, getFestival, supportedLanguages } from "@/data/festivals";
import { festivalMusicEvent } from "@/lib/seo";

export const dynamicParams = false;
export function generateStaticParams() { return supportedLanguages.flatMap((lang) => festivals.map(({ slug }) => ({ lang, slug }))); }

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const festival = getFestival(slug);
  if (!festival || !supportedLanguages.includes(lang as Language)) return {};
  return { title: festival.name, alternates: { canonical: `/${lang}/festivals/${festival.slug}/`, languages: { "x-default": `/festivals/${festival.slug}/`, en: `/en/festivals/${festival.slug}/`, de: `/de/festivals/${festival.slug}/`, ru: `/ru/festivals/${festival.slug}/` } } };
}

export default async function LocalizedFestivalPage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!supportedLanguages.includes(lang as Language)) notFound();
  const item = getFestival(slug);
  if (!item) notFound();
  const event = festivalMusicEvent(item);
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(event).replace(/</g, "\\u003c") }} /><FestivalDetail item={item} /></>;
}
