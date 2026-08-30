import type { MetadataRoute } from "next";
import { allArtists, artistSlug, festivalMonth, festivals, supportedLanguages } from "@/data/festivals";
import { editionYears, festivalEditions } from "@/data/editions";

export const dynamic = "force-static";

const origin = "https://festivals.kir-it.de";

export default function sitemap(): MetadataRoute.Sitemap {
  const countries = [...new Set(festivals.map((item) => item.countryCode.toLowerCase()))];
  const months = [...new Set(festivals.map(festivalMonth).filter((value): value is string => Boolean(value)))];
  return [
    { url: `${origin}/`, changeFrequency: "daily", priority: 1 },
    ...festivals.map(({ slug, startDate }) => ({ url: `${origin}/festivals/${slug}/`, lastModified: startDate, changeFrequency: "daily" as const, priority: .8 })),
    ...allArtists.map((artist) => ({ url: `${origin}/artists/${artistSlug(artist)}/`, changeFrequency: "weekly" as const, priority: .6 })),
    ...countries.map((code) => ({ url: `${origin}/countries/${code}/`, changeFrequency: "weekly" as const, priority: .7 })),
    ...months.map((month) => ({ url: `${origin}/months/${month}/`, changeFrequency: "weekly" as const, priority: .7 })),
    ...supportedLanguages.map((lang) => ({ url: `${origin}/${lang}/`, changeFrequency: "weekly" as const, priority: .8 })),
    ...editionYears.map((year) => ({ url: `${origin}/editions/${year}/`, changeFrequency: "monthly" as const, priority: .6 })),
    ...festivalEditions.map(({ slug, editionYear, snapshotAt }) => ({ url: `${origin}/festivals/${slug}/${editionYear}/`, lastModified: snapshotAt, changeFrequency: editionYear < 2027 ? "yearly" as const : "weekly" as const, priority: .6 })),
    { url: `${origin}/archive/`, changeFrequency: "monthly", priority: .5 },
    { url: `${origin}/submit/`, changeFrequency: "monthly", priority: .4 },
  ];
}
