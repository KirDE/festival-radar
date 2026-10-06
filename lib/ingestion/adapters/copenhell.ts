import type { FestivalSource } from "../types.ts";

type Result = { editionYear?: number; startDate?: string; endDate?: string; headliners?: string[]; excerpt: string; warning?: string };
const articleUrl = "https://copenhell.dk/faith-no-more-headline-copenhell-2027/";
const plain = (html: string) => html.replace(/&nbsp;|&#160;/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The announcement's publication timestamp is NOT the festival date. Its
// explicitly dated opening statement, edition label and headliner sentence
// must all agree. The undated programme and teaser list do not establish a
// complete, edition-bound lineup (including Blood Stain/Bloodstain drift).
export function copenhell(html: string, source: FestivalSource): Result | undefined {
  if (source.url !== articleUrl) return { excerpt: source.url, warning: "Copenhell 2027 extraction requires the dated official announcement URL" };
  if (source.editionYear !== 2027) return { excerpt: String(source.editionYear), warning: "Copenhell announcement edition differs from configured source year" };
  const main = html.match(/<main\b[^>]*\bid=["']main["'][^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const article = main?.match(/<article\b[^>]*\bclass=["'][^"']*\bh-entry\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (!article) return { excerpt: "Article missing", warning: "Copenhell official announcement article is missing" };
  const heading = plain(article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const time = article.match(/<time\b[^>]*\bdatetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/i);
  const intro = article.match(/<div\b[^>]*\bclass=["'][^"']*\bwysiwyg\b[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const statement = plain(intro ?? "");
  const match = statement.match(/\bCOPENHELL\s+(20\d{2})\s+finder sted\b[\s\S]*?\bden\s+(\d{1,2})\s*\.\s*[-–—]\s*(\d{1,2})\s*\.\s*juni\s+(20\d{2})\b/i);
  const ranges = [...statement.matchAll(/\b\d{1,2}\s*\.\s*[-–—]\s*\d{1,2}\s*\.\s*juni\s+20\d{2}\b/gi)];
  if (heading !== "FAITH NO MORE OG JUDAS PRIEST HEADLINER COPENHELL 2027" || !time ||
      !/^2026-10-06T\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(time[1]) || plain(time[2]) !== "06.10.2026" ||
      !match || ranges.length !== 1 || match[1] !== "2027" || match[4] !== "2027" ||
      !/FAITH NO MORE og JUDAS PRIEST\s+bliver næste års hovednavne\b/i.test(statement))
    return { excerpt: heading || "Announcement missing", warning: "Copenhell announcement date, edition, or headliner evidence is missing or inconsistent" };
  const start = new Date(Date.UTC(2027, 5, Number(match[2])));
  const end = new Date(Date.UTC(2027, 5, Number(match[3])));
  if (start.getUTCMonth() !== 5 || end.getUTCMonth() !== 5 || end.getTime() - start.getTime() !== 3 * 86400000)
    return { excerpt: statement.slice(0, 250), warning: "Copenhell announcement date range is invalid" };
  return {
    editionYear: 2027,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    headliners: ["Faith No More", "Judas Priest"],
    excerpt: heading + "; " + plain(time[2]) + "; " + statement.slice(0, 340),
  };
}
