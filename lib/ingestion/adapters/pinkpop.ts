import type { FestivalCandidate } from "../types.ts";

const months: Record<string, string> = { januari: "01", februari: "02", maart: "03", april: "04", mei: "05", juni: "06", juli: "07", augustus: "08", september: "09", oktober: "10", november: "11", december: "12" };
const pad = (value: string) => value.padStart(2, "0");
const origin = "https://www.pinkpop.nl";

function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
    const point = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? text(match[1] ?? match[2]) : "";
}

export function pinkpop(html: string) {
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const main = visible.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  // Preserve the older date-only landing page; artist evidence must be in main.
  const page = main ?? visible;
  const date = text(page).match(/(\d{1,2})\s*[•·]\s*(\d{1,2})\s*[•·]\s*(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/i);
  if (!date) return undefined;
  const location = page.match(/class=["'][^"']*location[^"']*["'][^>]*>[\s\S]{0,200}?<strong[^>]*>[^<]+<\/strong>\s*([^<]+)/i);
  const result = { startDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[1])}`, endDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[3])}`, city: location ? text(location[1]) : undefined, excerpt: date[0] };
  const artists = new Map<string, { name: string; headliner: boolean }>();
  let malformed = false;
  for (const match of (main ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(attribute(match[1], "href"), origin); } catch { continue; }
    if (url.origin !== origin || url.username || url.password || !/^\/line-up\/[^/]+\/?$/i.test(url.pathname)) continue;
    const classes = attribute(match[1], "class").split(/\s+/);
    const supported = classes.some(value => ["headliner", "pre-headliner", "sub", "else"].includes(value));
    const heading = match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const name = heading ? text(heading) : "";
    if (!supported || !name) { malformed = true; continue; }
    const key = name.toLocaleLowerCase();
    const prior = artists.get(key);
    artists.set(key, { name: prior?.name ?? name, headliner: !!prior?.headliner || classes.includes("headliner") });
  }
  const warnings = malformed ? ["Pinkpop artist card markup changed; review the incomplete extraction"] : [];
  if (!artists.size) return { ...result, warnings };
  // A homepage announcement is not a complete bill and must not erase reviewed acts.
  return { ...result, excerpt: `${date[0]}: ${[...artists.values()].map(a => a.name).join(", ")}`,
    headliners: [...artists.values()].filter(a => a.headliner).map(a => a.name),
    lineup: [...artists.values()].filter(a => !a.headliner).map(a => a.name),
    status: "partial" as FestivalCandidate["status"], artistListMode: "additive" as const, lineupScope: "announcement" as const, warnings };
}
