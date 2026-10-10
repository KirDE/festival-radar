import type { FestivalSource } from "../types.ts";

// Recognize the independently reviewed 2026 recap, not arbitrary image-only
// announcements. These public immutable upload paths identify the three
// responsive copies of that artwork. New artwork must retain manual review;
// neither the complete document hash nor a festival bill is pinned here.
const recapArtwork = new Set([
  "a71191478886f202.jpg",
  "3d153c3cf69ecd76.jpg",
  "f76b729cc9c2b9ef.jpg",
]);

export function isMadCoolArchivedEdition(html: string, source: FestivalSource): boolean {
  if (source.festivalSlug !== "mad-cool" || !Number.isInteger(source.editionYear)) return false;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.hostname !== "madcoolfestival.es" || url.pathname !== "/" || url.search || url.username || url.password || source.fetchUrl || source.followLinkPattern) return false;
    const visible = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    // Include script data and artwork/links: stale recap text cannot hide a
    // current-edition announcement. Ignore year-like substrings in the site's
    // random numeric cache-busters; a real footer year change fails closed.
    if ([...html.matchAll(/(?<!\d)20\d{2}(?!\d)/g)].some(([year]) => Number(year) > 2026)) return false;
    const hashtags = [...visible.matchAll(/#MadCool(20\d{2})/g)].map((match) => Number(match[1]));
    if (!hashtags.length || hashtags.some((year) => year !== 2026) || source.editionYear <= 2026) return false;
    const marquee = /<h2\b[^>]*class=["'][^"']*\bg--marquee__text\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i.exec(visible)?.[1];
    if (!marquee || !/ATTENDEES\s*•[\s\S]*ARTISTS\s*•\s*THANK YOU!/i.test(marquee)) return false;
    if ((visible.match(/class=["'][^"']*\bcarousel-item\b/g) ?? []).length !== 1) return false;
    const hero = /<div\b[^>]*id=["']carouselHome["'][^>]*>([\s\S]*?)<link\b[^>]*href=["'][^"']*\/marquee\.css["']/i.exec(visible)?.[1];
    if (!hero || (hero.match(/<img\b/gi) ?? []).length !== recapArtwork.size || /<(?:picture|video|iframe|source)\b/i.test(hero)) return false;
    const artwork = [...hero.matchAll(/<img\b[^>]*src=["']https:\/\/madcoolfestival\.es\/2023-app\/public\/uploads\/slider\/([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
    if (artwork.length !== recapArtwork.size || new Set(artwork).size !== recapArtwork.size || artwork.some((path) => !recapArtwork.has(path))) return false;
    const news = [...visible.matchAll(/<a\b[^>]*href=["']https:\/\/madcoolfestival\.es\/noticia\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    if (news.length !== 3 || news[0][1] !== "mad-cool-festival-2026-tenth-anniversary" || !/aria-label=["']This was Mad Cool Festival 10th anniversary["']/i.test(news[0][0]) || !/<h5\b[^>]*>\s*This was Mad Cool Festival 10th anniversary\s*<\/h5>/i.test(news[0][2])) return false;
    let previous = Infinity;
    for (const [, , card] of news) {
      const dates = [...card.matchAll(/<p\b[^>]*class=["'][^"']*\bg--main-card__date\b[^"']*["'][^>]*>\s*(\d{2})·(\d{2})·(20\d{2})\s*<\/p>/gi)];
      if (dates.length !== 1) return false;
      const [, day, month, year] = dates[0], date = new Date(`${year}-${month}-${day}T00:00:00Z`);
      if (Number(year) !== 2026 || !Number.isFinite(date.getTime()) || date.getUTCDate() !== Number(day) || date.getUTCMonth() + 1 !== Number(month) || date.getTime() > previous) return false;
      previous = date.getTime();
    }
    return true;
  } catch {
    return false;
  }
}
