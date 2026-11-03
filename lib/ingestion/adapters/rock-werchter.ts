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
  const faqDates = text(html).match(/Rock Werchter\s+(20\d{2})\s+(?:will take place|takes place|vindt plaats)\s+(?:from|van)\s+\w+\s+(\d{1,2})(?:\s+\w+)?\s+(?:through|to|tot en met)\s+\w+\s+(\d{1,2})\s+(\w+)\s+(?:at|in)\s+(?:the|het)\s+Festivalpark\s+(?:in\s+)?Werchter/i);
  // The current homepage no longer repeats dates in its FAQ. Its scoped
  // header time is the edition anchor; unrelated article dates are not.
  const header = html.match(/<div\b[^>]*class=["'][^"']*\bheader__content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const banner = text(header.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1] ?? "").match(/^(\d{1,2}(?:-\d{1,2})+)\s+(\w+)\s+(20\d{2})$/);
  const days = banner?.[1].split("-").map(Number) ?? [];
  const bannerDates = banner && /Festivalpark Werchter Belgium/.test(text(header)) && days.every((day, i) => !i || day === days[i - 1] + 1)
    ? [banner[0], banner[3], String(days[0]), String(days.at(-1)), banner[2]] : undefined;
  // Conflicting edition anchors must fail closed.
  if (faqDates && bannerDates && (faqDates[1] !== bannerDates[1] || faqDates[2] !== bannerDates[2] || faqDates[3] !== bannerDates[3] || monthNumber(faqDates[4]) !== monthNumber(bannerDates[4]))) return undefined;
  const dates = faqDates ?? bannerDates;
  if (!dates || Number(dates[1]) !== source.editionYear) return undefined;
  const month = monthNumber(dates[4]);
  const start = Number(dates[2]), end = Number(dates[3]);
  if (!month || start < 1 || end < start || end > 31 || new Date(Date.UTC(source.editionYear, month - 1, end)).getUTCMonth() !== month - 1) return undefined;
  const headliners: string[] = [], lineup: string[] = [];
  const excerpts = [dates[0]];
  const slides = [...html.matchAll(/<li\b[^>]*class=["'][^"']*\bsplide__slide\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].map(slide => {
    const title = slide[1].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const href = slide[1].match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
    return title && href ? `<a class="card" data-current-slide="true" href="${href}"><h3 class="card__title">${title}</h3></a>` : "";
  }).join("");
  for (const card of (html + slides).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bclass=["'][^"']*\bcard\b[^"']*["']/i.test(card[1])) continue;
    const href = card[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    let url: URL;
    try { url = new URL(href ?? "", source.url); } catch { continue; }
    if (url.origin !== "https://www.rockwerchter.be" || Boolean(url.username || url.password || url.search || url.hash) || !/^\/(?:en\/news|nl\/nieuws)\//.test(url.pathname)) continue;
    const title = text(card[2].match(/<h3\b[^>]*\bclass=["'][^"']*\bcard__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const headliner = title.match(/^(.+?)\s+(?:(?:first|new|another)\s+headliner\s+for|(?:eerste|nieuwe)\s+headliner\s+voor)\s+Rock Werchter\s+(20\d{2})$/i);
    const supporting = title.replace(/^Dis-le!\s+/i, "").replace(/!$/, "").match(/^(?:Ook\s+)?(.+?)\s+(?:is coming to|op|naar)\s+Rock Werchter\s+(20\d{2})$/i);
    const matched = headliner ?? supporting;
    // Only the active homepage carousel inherits the header edition. News cards
    // may include archives, so they still require their own year and URL anchor.
    const currentSlide = bannerDates && /data-current-slide="true"/.test(card[1]);
    const slideTitle = currentSlide && !/20\d{2}/.test(title) && (!/20\d{2}/.test(url.pathname) || url.pathname.endsWith(String(source.editionYear)))
      ? title.replace(/[!]+$/, "").match(/^(.+?)\s+(?:at Rock Werchter|op Rock Werchter|make their return at Rock Werchter|maakt zijn return op Rock Werchter|confirmed for Rock Werchter|komt naar Rock Werchter)$/i) : null;
    const dayTitle = currentSlide && !/20\d{2}/.test(title)
      ? title.match(/^(.+?)\s+(?:closes the Main Stage on|sluit de Main Stage af op|at Rock Werchter on)\s+\w+\s+(\d{1,2})\s+(\w+)$/i) : null;
    const validDay = dayTitle && days.includes(Number(dayTitle[2])) && monthNumber(dayTitle[3]) === month;
    const name = matched && Number(matched[2]) === source.editionYear && url.pathname.endsWith(String(source.editionYear))
      ? matched[1] : slideTitle?.[1] ?? (validDay ? dayTitle[1] : undefined);
    if (!name) continue;
    if (name.length > 100 || /\b(?:tickets?|lineup|line-up|countdown|terugblik)\b/i.test(name)) continue;
    const target = headliner || /(?:first-headliner|eerste-headliner)/.test(url.pathname) ? headliners : lineup;
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
