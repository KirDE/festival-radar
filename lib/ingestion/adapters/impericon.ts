import type { FestivalSource } from "../types.ts";

// This dated announcement is not an evergreen lineup grid. A different post
// needs a reviewed binding; changed/extra names must never be silently omitted.
export const impericonAnnouncementUrl = "https://www.impericon.com/blogs/festival/impericon-festival-2027-new-line-up-drop";
const title = "Impericon Festival 2027: New Line-Up Drop!";
const firstNames = ["Fit For A King", "Silverstein", "The Amity Affliction", "Wage War", "From Ashes To New", "Blood For Blood", "Speed", "Bodysnatcher"];
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(value => value !== undefined);
const text = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

function content(html: string): string | undefined {
  const openings = [...html.matchAll(/<div\b[^>]*>/gi)].filter(m => attr(m[0], "class") === "article__content");
  if (openings.length !== 1) return undefined;
  const opening = openings[0], start = opening.index! + opening[0].length;
  let depth = 1;
  for (const tag of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index!);
  }
  return undefined;
}

export function impericon(html: string, source: FestivalSource) {
  if (source.url !== impericonAnnouncementUrl || source.editionYear !== 2027 || !/<\/body>\s*<\/html>\s*$/i.test(html)) return undefined;
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const head = clean.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]?.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!head) return undefined;
  for (const [property, expected] of [["og:url", impericonAnnouncementUrl], ["og:title", title], ["og:type", "article"]]) {
    const tags = [...head.matchAll(/<meta\b[^>]*>/gi)].filter(m => attr(m[0], "property") === property);
    if (tags.length !== 1 || attr(tags[0][0], "content") !== expected) return undefined;
  }
  const canonicals = [...head.matchAll(/<link\b[^>]*>/gi)].filter(m => attr(m[0], "rel") === "canonical");
  if (canonicals.length !== 1 || attr(canonicals[0][0], "href") !== impericonAnnouncementUrl) return undefined;
  const body = clean.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]?.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!body) return undefined;
  const headings = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (headings.length !== 1 || text(headings[0][1]) !== title) return undefined;
  const article = content(body);
  if (!article) return undefined;
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1]);
  if (paragraphs.length !== 7) return undefined;
  const intro = text(paragraphs[0]);
  if (!/^You already know our headliners for Impericon Festival 2027\s*[–—-]\s*but today, Lorna Shore are finally getting some company on the lineup poster\. We are excited to announce eight more bands for the next edition of the festival!$/.test(intro)) return undefined;
  const headlinerLinks = [...paragraphs[0].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m => attr(m[1], "href") === "https://www.impericon.com/collections/lorna-shore");
  if (headlinerLinks.length !== 1 || text(headlinerLinks[0][2]) !== "Lorna Shore") return undefined;
  if (!text(paragraphs[1]).startsWith("Officially joining the bill:")) return undefined;
  const names = [...paragraphs[1].matchAll(/<b\b[^>]*>([^<>]+)<\/b>/gi)].map(m => text(m[1]));
  if (JSON.stringify(names) !== JSON.stringify(firstNames) || (article.match(/<b\b/gi) ?? []).length !== names.length) return undefined;
  if (text(paragraphs[2]) !== "More acts will follow – find tickets below!") return undefined;
  // Corroborate the dates from the uniquely linked edition-specific ticket.
  // The blog's publication date and navigation products are not event dates.
  const ticketTitles = [...body.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)].filter(m => attr(m[1], "class")?.split(/\s+/).includes("product-meta__title"));
  if (ticketTitles.length !== 1) return undefined;
  const tickets = [...ticketTitles[0][2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  if (tickets.length !== 1 || attr(tickets[0][1], "href") !== "/products/25-26-06-2027-2-preisstufe-weekend-ticket" || text(tickets[0][2]) !== "25/26.06.2027 2. Preisstufe - Weekend Ticket") return undefined;
  // No ticket availability is inferred from dated prose (VIP != weekend).
  return { editionYear: 2027, startDate: "2027-06-25", endDate: "2027-06-26", headliners: [text(headlinerLinks[0][2])], lineup: names, status: "partial" as const,
    excerpt: `${title}; 25/26.06.2027; explicitly billed headliner Lorna Shore; Officially joining the bill: ${names.join(", ")}; More acts will follow.` };
}
