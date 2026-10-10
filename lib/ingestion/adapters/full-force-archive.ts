import type { FestivalSource } from "../types.ts";

// A successful check of an explicitly archived homepage is not a recurring
// manual-review error. Three independent edition markers must agree; missing,
// changed or current-edition announcements retain the manual-review boundary.
export function isFullForceArchivedEdition(html: string, source: FestivalSource): boolean {
  if (source.festivalSlug !== "full-force" || !Number.isInteger(source.editionYear)) return false;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || !["full-force.de", "www.full-force.de"].includes(url.hostname) || !["/", "/en", "/en/"].includes(url.pathname)) return false;
    const dataScripts = [...html.matchAll(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi)];
    if (dataScripts.length !== 1) return false;
    const festival = JSON.parse(dataScripts[0][1]).props?.pageProps?.festival;
    const dateYear = (value: unknown): number | undefined => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return undefined;
      return Number(value.slice(0, 4));
    };
    const year = dateYear(festival?.start_date);
    if (!year || year >= source.editionYear || festival?.published !== true || dateYear(festival.end_date) !== year || !new RegExp(`^Full Force ${year}$`, "i").test(festival.name ?? "")) return false;
    const structured = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    if (structured.length !== 1) return false;
    let event;
    try {
      event = JSON.parse(structured[0][1]);
    } catch {
      // The live English page omits its final root brace. Accept only that
      // syntactic repair, never a truncated field or arbitrary broken JSON.
      event = JSON.parse(structured[0][1].trim() + "}");
    }
    if (event["@type"] !== "Festival" || !/^Full Force Festival$/i.test(event.name ?? "") || dateYear(event.startDate) !== year || dateYear(event.endDate) !== year) return false;
    const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    // Include embedded announcement data: an old hero must not hide a new edition.
    if ([...html.matchAll(/\b(20\d{2})\b/g)].some((match) => Number(match[1]) >= source.editionYear)) return false;
    const hero = /<p\b[^>]*>\s*(\d{1,2}\.\s*-\s*\d{1,2}\.\s*Juni\s+(20\d{2})|June\s+\d{1,2}\s*-\s*\d{1,2},\s*(20\d{2}))\s*<\/p>\s*<p\b[^>]*>\s*Ferropolis, Germany\s*<\/p>/gi;
    const heroes = [...visible.matchAll(hero)];
    return heroes.length === 1 && Number(heroes[0][2] ?? heroes[0][3]) === year;
  } catch {
    return false;
  }
}
