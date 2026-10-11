import type { FestivalSource } from "../types.ts";

// Pistoia's holding homepage mixes prior-edition concert posters and news.
// It is not a festival date range or a bill for the upcoming catalogue year.
// Quiet only this positively dated archived layout; new/ambiguous announcements
// retain manual review. No artist identities, document hashes or facts are saved.
export function isPistoiaBluesArchivedEdition(html: string, source: FestivalSource): boolean {
  if (source.festivalSlug !== "pistoia-blues" || !Number.isInteger(source.editionYear)) return false;
  try {
    const url = new URL(source.fetchUrl ?? source.url);
    if (url.protocol !== "https:" || !["pistoiablues.com", "www.pistoiablues.com"].includes(url.hostname) || url.pathname !== "/") return false;
    // Include announcement JSON and asset URLs, not just visible text. A new
    // edition anywhere invalidates the holding-page classification.
    const semantic = html.replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_match, hex, decimal) => {
      const code = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }).replace(/\b(?:id|class)=["'][^"']*["']/gi, "");
    if ([...semantic.matchAll(/\b(20\d{2})\b/g)].some(match => Number(match[1]) >= source.editionYear)) return false;
    if ([...semantic.matchAll(/ptblues(\d{2})/gi)].some(match => 2000 + Number(match[1]) >= source.editionYear)) return false;
    const markup = html.replace(/<!--[\s\S]*?-->/g, "");
    const slides = [...markup.matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*\brsImg\b[^"']*["'])[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    if (slides.length < 3) return false;
    const years: number[] = [];
    for (const [index, slide] of slides.entries()) {
      const asset = new URL(slide[1], url);
      if (asset.protocol !== "https:" || asset.hostname !== url.hostname) return false;
      const poster = /^\/wp-content\/uploads\/(20\d{2})\/\d{2}\/ptblues(\d{2})-[\w-]+\.jpg$/i.exec(asset.pathname);
      if (poster) {
        const year = 2000 + Number(poster[2]);
        if (Number(poster[1]) > year || year >= source.editionYear) return false;
        years.push(year);
      } else {
        // The last slider is the site's unversioned brand banner, not an act
        // card. Any other unknown/new image fails closed (including new posters).
        const banner = /^\/wp-content\/uploads\/(20\d{2})\/\d{2}\/ptblues-3-\d+x\d+\.jpg$/i.exec(asset.pathname);
        if (index !== slides.length - 1 || !banner || Number(banner[1]) >= source.editionYear || slide[2].trim() !== "ptblues--3") return false;
      }
    }
    if (years.length < 3 || new Set(years).size !== 1) return false;
    const headings = [...markup.matchAll(/<h3\b[^>]*\bclass=["'][^"']*\btitle-news\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi)];
    if (headings.length < 2) return false;
    const latest = headings[0][1].replace(/<[^>]+>/g, " ").trim();
    const latestYears = [...latest.matchAll(/\b(20\d{2})\b/g)];
    // A fresh undated first article is ambiguous, not an unchanged old edition.
    return latestYears.length === 1 && Number(latestYears[0][1]) === years[0];
  } catch {
    return false;
  }
}
