import type { FestivalSource } from "../types.ts";

const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
const attribute = (tag: string, key: string) => tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2];

// Read only explicit linked artist labels. Logo pixels, poster composition,
// billing size, ticket stock and a complete inventory are deliberately not inferred.
export function heavyWeekEnd(html: string, source: FestivalSource) {
  let page: URL;
  try { page = new URL(source.url); } catch { return undefined; }
  if (page.href !== "https://www.heavyweekend.live/") return undefined;
  const document = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const title = text(document.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const year = Number(title.match(/^Heavy Week-End\s+(20\d{2})$/i)?.[1]);
  if (!Number.isInteger(year) || year !== source.editionYear) return undefined;
  const dated = [...document.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(m => text(m[1])).filter(value => /^\d{1,2}(?:-\d{1,2})+\s+[\p{L}]+\s+20\d{2}$/u.test(value));
  const dates = [...new Set(dated)];
  if (dates.length !== 1) return undefined;
  const match = dates[0].match(/^(\d{1,2}(?:-\d{1,2})+)\s+([\p{L}]+)\s+(20\d{2})$/u)!;
  const month = months.indexOf(match[2].toLowerCase());
  const days = match[1].split("-").map(Number);
  if (Number(match[3]) !== year || month < 0 || days.some((day, i) => day < 1 || new Date(Date.UTC(year, month, day)).getUTCMonth() !== month || (i > 0 && day !== days[i - 1] + 1))) return undefined;
  const lineup: string[] = [];
  const evidence: string[] = [];
  for (const link of document.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(link[1], "href");
    if (!href) continue;
    let target: URL;
    try { target = new URL(href, page); } catch { continue; }
    if (!/^\/line-up\/[a-z0-9][a-z0-9-]*\/?$/.test(target.pathname)) continue;
    if (target.origin !== page.origin || target.username || target.password || target.search || target.hash) return undefined;
    const heading = link[2].match(/<h3\b[^>]*class=["'][^"']*\bartist-same-day-name\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const image = link[2].match(/<img\b[^>]*>/i)?.[0];
    const logo = image && attribute(image, "src")?.startsWith("https://cdn.prod.website-files.com/") ? attribute(image, "alt") : undefined;
    const name = text(heading ?? logo ?? "");
    // An unlabeled/image-only new card must retain review, not silently vanish.
    if (!name || name.length > 100 || /[<>]|&[a-z#\d]+;|\b(?:coming soon|tickets?|20\d{2})\b/i.test(name)) return undefined;
    if (lineup.some(old => old.toLowerCase() === name.toLowerCase())) continue;
    lineup.push(name); evidence.push(`${target.href}: ${name}`);
  }
  if (!lineup.length) return undefined;
  return { editionYear: year,
    startDate: new Date(Date.UTC(year, month, days[0])).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month, days.at(-1)!)).toISOString().slice(0, 10),
    lineup, status: "partial" as const, artistListMode: "additive" as const, lineupScope: "announcement" as const,
    excerpt: `${title}; ${dates[0]}; ${evidence.join("; ")}` };
}
