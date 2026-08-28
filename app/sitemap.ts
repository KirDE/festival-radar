import type { MetadataRoute } from "next";
import { allArtists, artistSlug, festivals } from "@/data/festivals";

export const dynamic = "force-static";

const origin = "https://festivals.kir-it.de";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${origin}/`, changeFrequency: "daily", priority: 1 },
    ...festivals.map(({ slug, startDate }) => ({ url: `${origin}/festivals/${slug}/`, lastModified: startDate, changeFrequency: "daily" as const, priority: .8 })),
    ...allArtists.map((artist) => ({ url: `${origin}/artists/${artistSlug(artist)}/`, changeFrequency: "weekly" as const, priority: .6 })),
  ];
}
