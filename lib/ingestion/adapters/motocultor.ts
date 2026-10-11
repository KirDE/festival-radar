import type { FestivalSource } from "../types.ts";

const origin = "https://www.motocultor-festival.com";
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(v => v !== undefined);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;|&#0*38;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#0*39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();

// News cards are newest first. Use a current-edition bill announcement, never
// the archived homepage, the Across Europe tour, navigation or ticket prose.
export function discoverMotocultorAnnouncement(html: string, source: FestivalSource): string | undefined {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of clean.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gi)) {
    if (!attr(m[1], "class")?.split(/\s+/).includes("blog-post_title")) continue;
    const a = m[2].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = text(a[2]);
    const years = title.match(/\b20\d{2}\b/g) ?? [];
    if (years.some(year => Number(year) !== source.editionYear) || !/noms|groupes|affiche|programmation/i.test(title) || /tour|across/i.test(title)) continue;
    // A cancellation news item must not silently fall through to older names.
    if (/annul|retir/i.test(title)) return undefined;
    try {
      const url = new URL(attr(a[1], "href") ?? "", origin);
      if (url.origin === origin && !url.search && !url.hash && /^\/[a-z0-9-]+\/$/.test(url.pathname)) return url.href;
    } catch { /* malformed card isn't a fetch target */ }
  }
  return undefined;
}

export function motocultor(html: string, source: FestivalSource) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const canonical = [...clean.matchAll(/<link\b[^>]*>/gi)].find(m => attr(m[0], "rel") === "canonical");
  try { if (new URL(attr(canonical?.[0] ?? "", "href") ?? "").origin !== origin) return undefined; } catch { return undefined; }
  const articles = [...clean.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)].filter(m => attr(m[1], "class")?.split(/\s+/).includes("blog-post-single-item"));
  if (articles.length !== 1) return undefined;
  const article = articles[0][2];
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const index = paragraphs.findIndex(m => new RegExp(`\\bMotocultor Festival\\s+${source.editionYear}\\b`, "i").test(text(m[1])) && /premiers noms|nouveaux noms|nouveaux groupes/i.test(text(m[1])));
  if (index < 0 || !paragraphs[index + 1]) return undefined;
  const intro = text(paragraphs[index][1]);
  if (/annul|retir|remplac|ne jouera/i.test(intro)) return undefined;
  const block = paragraphs[index + 1][1];
  if (/annul|retir|remplac|ne jouera/i.test(text(block))) return undefined;
  // Italic contextual show descriptions (Anthrax's songs) are not artists.
  const bold = [...block.matchAll(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  if (!bold.length || text(block.replace(/<(b|strong|i|em)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<br\b[^>]*>/gi, ""))) return undefined;
  const lineup = bold.flatMap(m => text(m[2]).split(/\s*·\s*/)).map(name => /^PEELING\s+FLESH$/i.test(name) ? "PeelingFlesh" : name);
  if (lineup.length < 1 || lineup.length > 150 || lineup.some(name => !name || name.length > 100 || /\b20\d{2}\b|€|early bird|billet/i.test(name)) || new Set(lineup.map(n => n.toLocaleLowerCase())).size !== lineup.length) return undefined;
  // The text is unranked. Poster-only dates, city and top billing stay verified
  // in the catalogue; don't infer Helloween's rank or ticket stock from prose.
  return { editionYear: source.editionYear, lineup, lineupScope: "announcement" as const,
    status: "partial" as const, excerpt: `${intro}; announced acts: ${lineup.join(", ")}` };
}
