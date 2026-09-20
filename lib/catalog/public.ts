import type { Festival } from "../../data/festivals.ts";

export const supportedLanguages = ["en", "de", "ru"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export function artistSlug(name: string) {
  return encodeURIComponent(name.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
}

export function festivalMonth(item: Festival) {
  return item.startDate?.slice(5, 7);
}
