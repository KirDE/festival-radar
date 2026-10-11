import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const origins = new Set(["https://www.infernofestival.net", "https://infernofestival.net", "https://infernofestival.no", "https://www.infernofestival.no"]);
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(v => v !== undefined);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;|&#x27;|&rsquo;|&lsquo;/gi, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, " ").trim();

export function isInfernoSource(source: FestivalSource): boolean {
  try { const u = new URL(source.url); return source.festivalSlug === "inferno" && origins.has(u.origin) && u.pathname === "/" && !u.search && !u.hash; } catch { return false; }
}
export function isInfernoResponse(url: string): boolean {
  try { const u = new URL(url); return origins.has(u.origin) && u.pathname === "/" && !u.search && !u.hash; } catch { return false; }
}

// Svelte hydration/script copies and invisible products are not visible evidence.
function visibleHtml(html: string): string {
  html = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const stack: { tag: string; hidden: boolean }[] = [];
  let output = "";
  for (const token of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    const close = token.match(/^<\/([\w-]+)/);
    if (close) {
      const index = stack.map(n => n.tag).lastIndexOf(close[1].toLowerCase());
      if (index >= 0) { const hidden = stack[index].hidden; stack.splice(index); if (!hidden) output += token; }
      continue;
    }
    const open = token.match(/^<([\w-]+)/);
    if (open) {
      const hidden = Boolean(stack.at(-1)?.hidden) || /\shidden(?:\s|=|\/?>)/i.test(token) || attr(token, "aria-hidden") === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(token, "style") ?? "");
      if (!hidden) output += token;
      if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(open[1]) && !/\/>$/.test(token)) stack.push({ tag: open[1].toLowerCase(), hidden });
    } else if (!stack.at(-1)?.hidden) output += token;
  }
  return output;
}

export function extractInfernoCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isInfernoSource(source)) return undefined;
  html = visibleHtml(html);
  const heroes = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => text(m[1]).match(/^INFERNO (20\d{2})$/i)).filter(m => m !== null);
  if (heroes.length !== 1) return undefined;
  const year = Number(heroes[0]![1]);
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [year] };
  if (year !== source.editionYear) { candidate.warnings.push(`Inferno visible edition ${year} does not match configured edition ${source.editionYear}`); return candidate; }
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  // Use the regular festival product, never the earlier conference/hotel bundle.
  const ranges: { start: string; end: string; excerpt: string; available: boolean; soldOut: boolean }[] = [];
  for (const card of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bdata-ticket-card(?:\s|=|$)/i.test(card[1])) continue;
    const title = text(card[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    if (!new RegExp(`^${year}\\s*[-–—]\\s*4 Day Festival Pass$`, "i").test(title)) continue;
    const description = text(card[2].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const range = description.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})$/i);
    if (!range || Number(range[4]) !== year) continue;
    const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(range[1].toLowerCase()) + 1;
    const first = Number(range[2]), last = Number(range[3]);
    const date = (day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!month || last - first !== 3 || [first, last].some(day => day < 1 || new Date(`${date(day)}T00:00:00Z`).getUTCDate() !== day)) continue;
    let purchase = false;
    try { const u = new URL(attr(card[1], "href") ?? ""); purchase = u.origin === "https://www.ticketmaster.no" && /^\/event\//.test(u.pathname) && /\bBuy(?: Tickets)?\b/i.test(text(card[2])) && attr(card[1], "aria-disabled") !== "true" && !/\sdisabled(?:\s|=|$)/i.test(card[1]); } catch { /* malformed purchase target */ }
    const soldOut = /\bsold\s*out\b/i.test(text(card[2]));
    ranges.push({ start: date(first), end: date(last), excerpt: `${title}; ${description}; ${text(card[2])}`, available: purchase && !soldOut && /\d+[.,-]*\s*NOK\b/.test(text(card[2])), soldOut });
  }
  if (ranges.length && ranges.every(r => r.start === ranges[0].start && r.end === ranges[0].end)) {
    add("startDate", ranges[0].start, ranges[0].excerpt); add("endDate", ranges[0].end, ranges[0].excerpt);
    if (ranges.some(r => r.available)) add("ticketStatus", "available", ranges.find(r => r.available)!.excerpt);
    else if (ranges.every(r => r.soldOut)) add("ticketStatus", "unavailable", ranges[0].excerpt);
  } else if (ranges.length) candidate.warnings.push("Conflicting Inferno festival pass dates require review");
  for (const link of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    try { const u = new URL(attr(link[1], "href") ?? "", source.url); if (origins.has(u.origin) && /^\/tickets\/?$/.test(u.pathname) && !u.search && !u.hash && /^Tickets$/i.test(text(link[2]))) { add("ticketsUrl", new URL("/tickets", source.url).href, text(link[0])); break; } } catch { /* ignore malformed links */ }
  }
  // Only the current visible announcement section owns artists. News, archive
  // cards and artist biographies outside it are not a bill or billing hierarchy.
  const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)].filter(m => /<h2\b[^>]*>\s*Lineup in progress\s*<\/h2>/i.test(m[1]));
  if (sections.length === 1) {
    if ([...text(sections[0][1]).matchAll(/\b20\d{2}\b/g)].some(m => Number(m[0]) !== year)) {
      candidate.warnings.push("Inferno announcement section contains another edition; artist review required");
      return candidate;
    }
    const artists: string[] = [];
    for (const link of sections[0][1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      try {
        const u = new URL(attr(link[1], "href") ?? "", source.url);
        if (!origins.has(u.origin) || !/^\/artists\/[^/]+\/?$/.test(u.pathname) || u.search || u.hash) continue;
        // Apostrophe typography varies between official cards and the reviewed
        // catalogue; normalize consistently without a hardcoded artist roster.
        const name = text(link[2]).replace(/['‘’]/g, "’");
        if (name && !artists.some(n => n.toLocaleLowerCase() === name.toLocaleLowerCase())) artists.push(name);
      } catch { /* malformed artist link */ }
    }
    if (artists.length) {
      candidate.artistListMode = "additive"; candidate.lineupScope = "announcement";
      add("lineup", artists, artists.join("; ")); add("status", "partial", "Lineup in progress; " + text(sections[0][1]).slice(-150));
    }
  }
  return candidate;
}
