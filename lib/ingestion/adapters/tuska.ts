import type { FestivalSource } from "../types.ts";

export const TUSKA_DOCUMENTS = "tuska-announcement-v1";
const origin = "https://tuska.fi";
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#(x[\da-f]+|\d+);/gi, (entity, value: string) => {
  const n = value[0].toLowerCase() === "x" ? Number.parseInt(value.slice(1), 16) : Number(value);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
}).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(v => v !== undefined);

export function tuskaArticleUrl(value: string, year: number): string | undefined {
  try {
    const url = new URL(value, origin);
    if (url.origin === origin && !url.username && !url.password && !url.search && !url.hash &&
        new RegExp(`^/(?:en/)?tuska-${year}-[a-z0-9-]+/$`).test(url.pathname)) return url.href;
  } catch { /* Not an official announcement. */ }
  return undefined;
}

export function isTuskaHomepage(source: FestivalSource): boolean {
  return source.festivalSlug === "tuska" && source.strategies.includes("official_markup") &&
    !source.fetchUrl && !source.followLinkPattern && [origin + "/", origin + "/en/"].includes(source.url);
}

export function discoverTuskaAnnouncement(html: string, year: number): string | undefined {
  const visible = clean(html).replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const main = [...visible.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)]
    .find(m => attr(m[1], "class")?.split(/\s+/).includes("block-article-highlights") &&
      /^(?:News|Uutiset)$/i.test(text(m[2].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "")))?.[2] ?? "";
  // Official news cards are newest first. Never use concert cards, archives,
  // script data or footer links to select a festival announcement.
  for (const a of main.matchAll(/<a\b([^>]*)>/gi)) {
    if (!attr(a[1], "class")?.split(/\s+/).includes("card-link-overlay")) continue;
    const url = tuskaArticleUrl(attr(a[1], "href") ?? "", year);
    if (url) return url;
  }
  return undefined;
}

export function tuska(input: string, source: FestivalSource) {
  let home = input;
  let article: { url: string; html: string } | undefined;
  if (input.trimStart().startsWith("{")) {
    try {
      const envelope = JSON.parse(input);
      if (envelope.kind !== TUSKA_DOCUMENTS || typeof envelope.home !== "string" ||
          !envelope.article || typeof envelope.article.html !== "string" ||
          !tuskaArticleUrl(envelope.article.url, source.editionYear) || !isTuskaHomepage(source) ||
          discoverTuskaAnnouncement(envelope.home, source.editionYear) !== envelope.article.url) return undefined;
      home = envelope.home; article = envelope.article;
    } catch { return undefined; }
  }
  const date = text(clean(home).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .match(/Tuska Festival\s*[-–—]\s*(\d{1,2})\.[–-](\d{1,2})\.(\d{1,2})\.(20\d{2})/i);
  if (!date) return undefined;
  const result = {startDate: `${date[4]}-${date[3].padStart(2, "0")}-${date[1].padStart(2, "0")}`,
    endDate: `${date[4]}-${date[3].padStart(2, "0")}-${date[2].padStart(2, "0")}`, excerpt: date[0]};
  if (!article) return result; // Preserve the older date-only landing page.
  const fail = () => ({...result, warning: "Tuska announcement has no trustworthy current-edition day bill; review required"});
  if (Number(date[4]) !== source.editionYear) return fail();
  const document = clean(article.html);
  const canonical = [...document.matchAll(/<link\b[^>]*>/gi)].find(m => attr(m[0], "rel") === "canonical");
  if (!canonical || tuskaArticleUrl(attr(canonical[0], "href") ?? "", source.editionYear) !== article.url) return fail();
  const main = document.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const body = [...main.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)]
    .find(m => attr(m[1], "class")?.split(/\s+/).includes("block-content-wrapper"))?.[2] ?? "";
  const heading = text(body.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
  if (!new RegExp(`^Tuska ${source.editionYear}:`, "i").test(heading) || /\b20\d{2}\b/g.test(heading.replace(String(source.editionYear), ""))) return fail();
  const lines = body.replace(/<br\s*\/?\s*>|<\/p>/gi, "\n").split("\n").map(text).filter(Boolean);
  const start = lines.findIndex(line => new RegExp(`^(?:Vahvistuneet Tuska ${source.editionYear} -esiintyjät esiintymispäivittäin:|Confirmed Artists for Tuska ${source.editionYear} according to the show day)$`, "i").test(line));
  const stop = lines.findIndex((line, i) => i > start && /^(?:Tarkat soittoaikataulut|Exact show times will be announced later)/i.test(line));
  if (start < 0 || stop < 0) return fail();
  const groups: {date: string; weekday: number; rows: string[][]}[] = [];
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const finnish = ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"];
  for (const line of lines.slice(start + 1, stop)) {
    const day = line.match(/^(Friday|Saturday|Sunday|Perjantai|Lauantai|Sunnuntai) (\d{1,2})\.(\d{1,2})\.(20\d{2})$/i);
    if (day) {
      const weekday = [...weekdays, ...finnish].findIndex(name => name.toLowerCase() === day[1].toLowerCase()) % 7;
      groups.push({date: `${day[4]}-${day[3].padStart(2, "0")}-${day[2].padStart(2, "0")}`, weekday, rows: []});
    } else {
      const names = line.split(/,\s*/);
      if (!groups.length || names.some(name => !name || name.length > 100 || /[<>:;!?€]|\b20\d{2}\b|tickets|liput/i.test(name))) return fail();
      groups.at(-1)!.rows.push(names);
    }
  }
  if (groups.length !== 3 || groups[0].date !== result.startDate || groups.at(-1)!.date !== result.endDate ||
      groups.some((g, i) => !g.rows.length || g.rows[0].length !== 1 || new Date(g.date + "T00:00:00Z").getUTCDay() !== g.weekday ||
        (i > 0 && Date.parse(g.date) - Date.parse(groups[i - 1].date) !== 86400000))) return fail();
  const headliners = groups.map(g => g.rows[0][0]);
  const lineup = groups.flatMap(g => g.rows.slice(1).flat());
  const names = [...headliners, ...lineup];
  if (!lineup.length || names.length > 150 || new Set(names.map(n => n.toLowerCase())).size !== names.length) return fail();
  return {...result, headliners, lineup, status: "partial" as const, editionYear: source.editionYear,
    artistListMode: "additive" as const, lineupScope: "announcement" as const, lineupSourceUrl: article.url,
    excerpt: `Tuska ${source.editionYear}: ${names.join(", ")}`};
}
