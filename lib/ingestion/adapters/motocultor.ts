import type { FestivalSource } from "../types.ts";

const origin = "https://www.motocultor-festival.com";
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(v => v !== undefined);
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;|&#0*38;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#0*39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();

// News cards are newest first. Use a current-edition bill announcement, never
// the archived homepage, the Across Europe tour, navigation or ticket prose.
export function discoverMotocultorAnnouncement(html: string, source: FestivalSource): string | undefined {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const cards = [...clean.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)]
    .filter(m => attr(m[1], "class")?.split(/\s+/).includes("news-card"));
  const headings = cards.length ? cards.map(m => ({
    heading: m[2].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "",
    // Astro cards carry the edition in their poster alt, not always the title.
    context: [...m[2].matchAll(/<img\b[^>]*>/gi)].map(img => attr(img[0], "alt") ?? "").join(" "),
  })) : [...clean.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gi)]
    .filter(m => attr(m[1], "class")?.split(/\s+/).includes("blog-post_title"))
    .map(m => ({heading: m[2], context: ""}));
  for (const {heading, context} of headings) {
    const a = heading.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = text(a[2]);
    const years = `${title} ${context}`.match(/\b20\d{2}\b/g) ?? [];
    if (cards.length && !years.some(y => Number(y) === source.editionYear)) continue;
    if (years.some(year => Number(year) !== source.editionYear) || !/noms|groupes|affiche|programmation/i.test(title) || /tour|across/i.test(title)) continue;
    // A cancellation news item must not silently fall through to older names.
    if (/annul|retir/i.test(title)) return undefined;
    try {
      const url = new URL(attr(a[1], "href") ?? "", origin);
      if (url.origin === origin && !url.search && !url.hash && /^\/(?:actualites\/)?[a-z0-9-]+\/$/.test(url.pathname)) return url.href;
    } catch { /* malformed card isn't a fetch target */ }
  }
  return undefined;
}

function astroAnnouncement(article: string, source: FestivalSource) {
  // Bind the article itself to this edition; site navigation and sibling links
  // must never supply a missing year or contribute artists.
  const body = article.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "");
  const title = text(body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const editionContext = title + " " + [...body.matchAll(/<img\b[^>]*>/gi)].map(img => attr(img[0], "alt") ?? "").join(" ");
  const years = editionContext.match(/\b20\d{2}\b/g) ?? [];
  if (!years.some(y => Number(y) === source.editionYear) || years.some(y => Number(y) !== source.editionYear)) return undefined;
  if (/annul|retir|remplac|ne jouera|across|\btour\b/i.test(text(body))) return undefined;
  const paragraphs = [...body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    .filter(m => !attr(m[1], "class")).map(m => text(m[2]));
  let names: string[];
  const next = paragraphs.findIndex(p => /nouveaux noms qui rejoignent la programmation/i.test(p) && /:\s*$/.test(p));
  if (next >= 0 && paragraphs[next + 1]) {
    names = paragraphs[next + 1].replace(/\.$/, "").split(/,\s*|\s+et\s+/i);
  } else {
    if (!/premiers noms/i.test(title) || !paragraphs.some(p => new RegExp(`édition ${source.editionYear}\\b`).test(p))) return undefined;
    const billed = paragraphs.find(p => /^En tête d[’']affiche\s*:/i.test(p));
    const rest = paragraphs.find(p => /^Et aussi\s*:/i.test(p));
    if (!billed || !rest) return undefined;
    const ranked = billed.match(/^En tête d[’']affiche\s*:\s*(.+?)\.\s*À leurs côtés\s*:\s*(.+)\.$/i);
    if (!ranked) return undefined;
    names = [ranked[1], ...ranked[2].split(/,\s*|\s+et\s+/i), ...rest.replace(/^Et aussi\s*:\s*/i, "").replace(/\.$/, "")
      .replace(/\s*\(celebrating the songs of Anthrax,\s*\d{4}[-–]\d{4}\)/i, "").split(/,\s*|\s+et\s+/i)];
  }
  const lineup = names.map(n => /^peeling\s*flesh$/i.test(n.trim()) ? "PeelingFlesh" : n.trim());
  const count = title.match(/\b(\d+) nouveaux (?:noms|groupes)\b/i);
  if (count && Number(count[1]) !== lineup.length) return undefined;
  if (!lineup.length || lineup.length > 150 || lineup.some(n => !n || n.length > 100 || /[():;.!?]|\b20\d{2}\b|€|billet|early bird/i.test(n)) || new Set(lineup.map(n => n.toLocaleLowerCase())).size !== lineup.length) return undefined;
  return {editionYear: source.editionYear, lineup, lineupScope: "announcement" as const,
    status: "partial" as const, excerpt: `Motocultor Festival ${source.editionYear}: ${title}; announced acts: ${lineup.join(", ")}`};
}

export function motocultor(html: string, source: FestivalSource) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const canonical = [...clean.matchAll(/<link\b[^>]*>/gi)].find(m => attr(m[0], "rel") === "canonical");
  try { if (new URL(attr(canonical?.[0] ?? "", "href") ?? "").origin !== origin) return undefined; } catch { return undefined; }
  const articles = [...clean.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)].filter(m => attr(m[1], "class")?.split(/\s+/).some(c => ["blog-post-single-item", "news-article"].includes(c)));
  if (articles.length !== 1) return undefined;
  const article = articles[0][2];
  if (attr(articles[0][1], "class")?.split(/\s+/).includes("news-article")) return astroAnnouncement(article, source);
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
