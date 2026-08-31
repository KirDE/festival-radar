import type { MetadataRoute } from "next";
import { allArtists, artistSlug, festivalMonth, festivals, supportedLanguages } from "@/data/festivals";
import { CATALOG_UPDATED_AT, SITE_ORIGIN } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const countries = [...new Set(festivals.map((item) => item.countryCode.toLowerCase()))];
  const months = [...new Set(festivals.map(festivalMonth).filter((value): value is string => Boolean(value)))];
  return [
    { url: `${SITE_ORIGIN}/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "daily", priority: 1 },
    ...festivals.map(({ slug, updatedAt }) => ({ url: `${SITE_ORIGIN}/festivals/${slug}/`, lastModified: updatedAt, changeFrequency: "daily" as const, priority: .8 })),
    ...allArtists.map((artist) => ({ url: `${SITE_ORIGIN}/artists/${artistSlug(artist)}/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "weekly" as const, priority: .6 })),
    ...countries.map((code) => ({ url: `${SITE_ORIGIN}/countries/${code}/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "weekly" as const, priority: .7 })),
    ...months.map((month) => ({ url: `${SITE_ORIGIN}/months/${month}/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "weekly" as const, priority: .7 })),
    ...supportedLanguages.map((lang) => ({ url: `${SITE_ORIGIN}/${lang}/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "weekly" as const, priority: .8 })),
    { url: `${SITE_ORIGIN}/archive/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "monthly", priority: .5 },
    { url: `${SITE_ORIGIN}/submit/`, lastModified: CATALOG_UPDATED_AT, changeFrequency: "monthly", priority: .4 },
  ];
}
