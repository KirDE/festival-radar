import type { FestivalCandidate, FestivalSource } from "../types.ts";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const dutch = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
const monthNumber = (name: string) => Math.max(months.indexOf(name.toLowerCase()), dutch.indexOf(name.toLowerCase())) + 1;

// Homepage news cards are announcements, not a complete artist inventory. Root
// redirects to Dutch; support that page and its English counterpart explicitly.
export function rockWerchter(html: string, source: FestivalSource, fetchedAt: string) {
  let sourceUrl: URL;
  try { sourceUrl = new URL(source.url); } catch { return undefined; }
  if (sourceUrl.origin !== "https://www.rockwerchter.be" || !["/", "/en", "/en/", "/nl", "/nl/"].includes(sourceUrl.pathname) || sourceUrl.search || sourceUrl.hash) return undefined;
  const dates = text(html).match(/Rock Werchter\s+(20\d{2})\s+(?:will take place|takes place|vindt plaats)\s+(?:from|van)\s+\w+\s+(\d{1,2})(?:\s+\w+)?\s+(?:through|to|tot en met)\s+\w+\s+(\d{1,2})\s+(\w+)\s+(?:at|in)\s+(?:the|het)\s+Festivalpark\s+(?:in\s+)?Werchter/i);
  if (!dates || Number(dates[1]) !== source.editionYear) return undefined;
  const month = monthNumber(dates[4]);
  const start = Number(dates[2]), end = Number(dates[3]);
  if (!month || start < 1 || end < start || end > 31 || new Date(Date.UTC(source.editionYear, month - 1, end)).getUTCMonth() !== month - 1) return undefined;
  const headliners: string[] = [], lineup: string[] = [];
  const excerpts = [dates[0]];
  for (const card of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bclass=["'][^"']*\bcard\b[^"']*["']/i.test(card[1])) continue;
    const href = card[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    let url: URL;
    try { url = new URL(href ?? "", source.url); } catch { continue; }
    if (url.hostname !== "www.rockwerchter.be" || !/^\/(?:en\/news|nl\/nieuws)\//.test(url.pathname)) continue;
    const title = text(card[2].match(/<h3\b[^>]*\bclass=["'][^"']*\bcard__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const headliner = title.match(/^(.+?)\s+(?:(?:first|new|another)\s+headliner\s+for|(?:eerste|nieuwe)\s+headliner\s+voor)\s+Rock Werchter\s+(20\d{2})$/i);
    const supporting = title.match(/^(?:Ook\s+)?(.+?)\s+(?:is coming to|op|naar)\s+Rock Werchter\s+(20\d{2})$/i);
    const matched = headliner ?? supporting;
    if (!matched || Number(matched[2]) !== source.editionYear || !url.pathname.endsWith(String(source.editionYear))) continue;
    const name = matched[1];
    if (name.length > 100 || /\b(?:tickets?|lineup|line-up|countdown|terugblik)\b/i.test(name)) continue;
    const target = headliner ? headliners : lineup;
    if (!target.some(other => other.toLowerCase() === name.toLowerCase())) target.push(name);
    excerpts.push(title);
  }
  const result: { editionYear: number; startDate: string; endDate: string; headliners?: string[]; lineup?: string[]; status?: FestivalCandidate["status"]; ticketStatus?: FestivalCandidate["ticketStatus"]; artistListMode: "additive"; excerpt: string } = {
    editionYear: source.editionYear,
    startDate: `${source.editionYear}-${String(month).padStart(2, "0")}-${String(start).padStart(2, "0")}`,
    endDate: `${source.editionYear}-${String(month).padStart(2, "0")}-${String(end).padStart(2, "0")}`,
    artistListMode: "additive", excerpt: "",
  };
  if (headliners.length) result.headliners = headliners;
  if (lineup.length) result.lineup = lineup.filter(name => !headliners.some(other => other.toLowerCase() === name.toLowerCase()));
  if (headliners.length || lineup.length) result.status = "partial";
  const sale = text(html).match(/(?:Ticket sales start on|De ticketverkoop start op)\s+\w+\s+(\d{1,2})\s+(\w+)(?:\s+(20\d{2}))?\s+(?:at|om)\s+\d{1,2}/i);
  if (sale) {
    const saleMonth = monthNumber(sale[2]);
    const saleYear = Number(sale[3] ?? (saleMonth > month ? source.editionYear - 1 : source.editionYear));
    const saleDate = new Date(Date.UTC(saleYear, saleMonth - 1, Number(sale[1])));
    // Before the announced sale day: unavailable. After it: do not invent
    // availability from a stale FAQ; wait for explicit purchase evidence.
    if (saleMonth && saleDate.getUTCMonth() === saleMonth - 1 && fetchedAt.slice(0, 10) < saleDate.toISOString().slice(0, 10)) {
      result.ticketStatus = "unavailable";
      excerpts.push(sale[0]);
    }
  }
  result.excerpt = excerpts.join("; ");
  return result;
}
