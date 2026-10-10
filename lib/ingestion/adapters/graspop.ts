import type { FestivalSource } from "../types.ts";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The live essentials FAQ has current facts inside an outdated site template. */
export function graspop(html: string, source: FestivalSource) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) return undefined;
  const text = main.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  const pattern = /Graspop Metal Meeting\s+(20\d{2})\s+takes place from\s+(\d{1,2})\s+(?:through|to|[-–—])\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi;
  const dates = [...text.matchAll(pattern)].filter(match => Number(match[1]) === source.editionYear);
  if (!dates.length) return undefined;
  const ranges = dates.map(match => {
    const month = String(months.findIndex(value => value.toLowerCase() === match[4].toLowerCase()) + 1).padStart(2, "0");
    return { startDate: `${match[1]}-${month}-${match[2].padStart(2, "0")}`, endDate: `${match[1]}-${month}-${match[3].padStart(2, "0")}`, excerpt: match[0] };
  });
  const first = ranges[0];
  if (ranges.some(range => range.startDate !== first.startDate || range.endDate !== first.endDate)) return undefined;
  if (first.startDate > first.endDate || [first.startDate, first.endDate].some(date => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date;
  })) return undefined;
  return first;
}
