import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((v) => v !== undefined);

export function isLeedsSource(source: FestivalSource): boolean {
  try {
    const url = new URL(source.url);
    return source.festivalSlug === "leeds" && url.origin === "https://www.leedsfestival.com" && /^\/(?:tickets\/?)?$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

// Remove non-visible nodes before using purchase controls or date banners. This
// avoids commented/hidden stale products, scripts and cookie/navigation copy.
function visibleHtml(html: string): string {
  html = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const stack: { tag: string; hidden: boolean }[] = [];
  let result = "";
  for (const token of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    const closing = token.match(/^<\/([\w-]+)/);
    if (closing) {
      const index = stack.map((node) => node.tag).lastIndexOf(closing[1].toLowerCase());
      if (index >= 0) { const hidden = stack[index].hidden; stack.splice(index); if (!hidden) result += token; }
      continue;
    }
    const opening = token.match(/^<([\w-]+)/);
    if (opening) {
      const hidden = Boolean(stack.at(-1)?.hidden) || /\shidden(?:\s|=|\/?>)/i.test(token) || attr(token, "aria-hidden") === "true" || /(?:^|\s)(?:hide|w-condition-invisible)(?:\s|$)/i.test(attr(token, "class") ?? "") || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(token, "style") ?? "");
      if (!hidden) result += token;
      if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(opening[1]) && !/\/>$/.test(token)) stack.push({ tag: opening[1].toLowerCase(), hidden });
    } else if (!stack.at(-1)?.hidden) result += token;
  }
  return result;
}

function divBlock(html: string, start: number): string {
  let depth = 0;
  for (const token of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(token[0]) ? -1 : 1;
    if (!depth) return html.slice(start, start + token.index! + token[0].length);
  }
  return "";
}

export function extractLeedsCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isLeedsSource(source)) return undefined;
  html = visibleHtml(html);
  // Use the visible advertised festival span, not early-entry Wednesday,
  // campsite closing Monday or the shorter arena-only span.
  const banners = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\baction-bar_cta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)];
  const ranges = banners.flatMap((banner) => {
    const value = text(banner[1]);
    const match = value.match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/);
    if (!match) return [];
    const month = months.findIndex((m) => [m, m.slice(0, 3)].includes(match[3].toLowerCase())) + 1;
    const year = Number(match[4]), first = Number(match[1]), last = Number(match[2]);
    const date = (day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!month || last < first || last - first > 7 || [first, last].some((day) => day < 1 || new Date(`${date(day)}T00:00:00Z`).getUTCDate() !== day)) return [];
    return [{ year, month, startDate: date(first), endDate: date(last), excerpt: value }];
  });
  const range = ranges[0];
  if (!range || ranges.some((r) => r.startDate !== range.startDate || r.endDate !== range.endDate)) return undefined;
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [range.year] };
  const add = (field: FieldEvidence["field"], value: string, excerpt: string, sourceUrl = source.url) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  add("startDate", range.startDate, range.excerpt); add("endDate", range.endDate, range.excerpt);
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    try {
      const url = new URL(match[1], source.url);
      if (url.origin === "https://www.leedsfestival.com" && /^\/tickets\/?$/.test(url.pathname) && !url.search && !url.hash) { add("ticketsUrl", url.href, text(match[0])); break; }
    } catch { /* malformed link is not evidence */ }
  }
  const cards = [...html.matchAll(/<div\b[^>]*class=["']tickets_card["'][^>]*>/gi)];
  const statuses: ("available" | "unavailable" | "unknown")[] = [];
  let purchaseExcerpt = "";
  for (let i = 0; i < cards.length; i++) {
    const card = divBlock(html, cards[i].index!);
    const name = text(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    if (!/^Weekend (?:Camping|Non-Camping)$/i.test(name)) continue;
    const description = text(card.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? "");
    if (!new RegExp(`\\b${months[range.month - 1]} ${range.year}\\b`, "i").test(description) || /\b20\d{2}\b/.test(description.replaceAll(String(range.year), ""))) continue;
    const body = text(card);
    const soldOut = /\bsold\s*out\b/i.test(body);
    const purchase = [...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some((link) => {
      if (!/^Buy$/i.test(text(link[2])) || /\sdisabled(?:\s|=|$)/i.test(link[1]) || attr(link[1], "aria-disabled") === "true") return false;
      try { const url = new URL(attr(link[1], "href") ?? ""); return url.origin === "https://www.ticketmaster.co.uk" && /^\/event\/[A-Za-z0-9]+\/?$/.test(url.pathname); } catch { return false; }
    });
    const state = soldOut ? "unavailable" : purchase && /£\s*\d+(?:\.\d{2})?/.test(body) ? "available" : "unknown";
    statuses.push(state);
    if (state === "available" || !purchaseExcerpt) purchaseExcerpt = `${name}; ${description}; ${state === "available" ? "priced Buy control" : state}`;
  }
  const status = statuses.includes("available") ? "available" : statuses.length && statuses.every((s) => s === "unavailable") ? "unavailable" : undefined;
  if (status) add("ticketStatus", status, purchaseExcerpt, "https://www.leedsfestival.com/tickets");
  // No lineup/status output: archived 2026 news is not a 2027 announcement.
  return candidate;
}
