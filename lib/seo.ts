import type { Festival } from "@/data/festivals";

export const SITE_ORIGIN = "https://festivals.kir-it.de";
export const CATALOG_UPDATED_AT = "2026-08-29T10:59:59.000Z";

export function canonicalPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function festivalMusicEvent(item: Festival) {
  const hasVerifiedDates = Boolean(item.startDate);
  const availability = item.ticketStatus === "available"
    ? "https://schema.org/InStock"
    : item.ticketStatus === "unavailable"
      ? "https://schema.org/SoldOut"
      : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: item.name,
    ...(item.startDate ? { startDate: item.startDate } : {}),
    ...(item.endDate ? { endDate: item.endDate } : {}),
    ...(hasVerifiedDates && item.status !== "tba"
      ? { eventStatus: "https://schema.org/EventScheduled" }
      : {}),
    location: {
      "@type": "Place",
      name: item.city || item.country,
      address: { "@type": "PostalAddress", addressCountry: item.countryCode },
    },
    url: `${SITE_ORIGIN}/festivals/${item.slug}/`,
    sameAs: item.officialUrl,
    ...(item.ticketsUrl && availability
      ? { offers: { "@type": "Offer", url: item.ticketsUrl, availability } }
      : {}),
  };
}
