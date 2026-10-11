import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import { visibleHtml } from "./reading.ts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const months = ["january|janvier", "february|février", "march|mars", "april|avril", "may|mai", "june|juin", "july|juillet", "august|août", "september|septembre", "october|octobre", "november|novembre", "december|décembre"];
export function isPaleoTicketUrl(value: string): boolean {
  try { const url = new URL(value); return url.origin === "https://yeah.paleo.ch" && !url.username && !url.password && /^\/(?:en\/tickets|fr\/billetterie)\/?$/.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
}
export function isPaleoSource(source: FestivalSource): boolean {
  try { const url = new URL(source.url); return source.festivalSlug === "paleo" && url.origin === "https://yeah.paleo.ch" && !url.username && !url.password && (/^\/(?:en|fr)?\/?$/.test(url.pathname) || isPaleoTicketUrl(url.href)) && !url.search && !url.hash; } catch { return false; }
}
export function paleoTicketLink(html: string, base: string): string | undefined {
  let localized: string | undefined;
  for (const link of visibleHtml(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try { const url = new URL(link[1], base); if (isPaleoTicketUrl(url.href)) { if (/^\/en\/tickets/.test(url.pathname)) return url.href; localized ??= url.href; } } catch { /* malformed link is not evidence */ }
  }
  return localized;
}

export function extractPaleoCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isPaleoSource(source)) return undefined;
  html = visibleHtml(html);
  // Use the official next-edition sentence, not the archived programme or wishes
  // competition. No artist/billing fields are inferred from this ticket page.
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(m => text(m[1]));
  const ranges = headings.flatMap(value => {
    const match = value.match(/^(?:The next edition of the Festival will take place from|La prochaine édition du Festival aura lieu du)\s+(\d{1,2})\s+(?:to|au)\s+(\d{1,2})\s+([\p{L}]+)\s+(20\d{2})\.?$/iu);
    if (!match) return [];
    const month = months.findIndex(m => m.split("|").includes(match[3].toLowerCase())) + 1;
    const year = Number(match[4]), first = Number(match[1]), last = Number(match[2]);
    const date = (day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!month || last < first || last - first > 10 || [first,last].some(day => day < 1 || new Date(`${date(day)}T00:00:00Z`).getUTCDate() !== day)) return [];
    return [{ startDate: date(first), endDate: date(last), year, excerpt: value }];
  });
  const range = ranges[0];
  if (!range || ranges.some(r => r.startDate !== range.startDate || r.endDate !== range.endDate)) return undefined;
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [range.year] };
  const documentUrl = isPaleoTicketUrl(source.url) ? source.url : `https://yeah.paleo.ch/${range.excerpt.startsWith("La ") ? "fr/billetterie" : "en/tickets"}`;
  const add = (field: FieldEvidence["field"], value: string, excerpt: string, sourceUrl = documentUrl) => { Object.assign(candidate, { [field]: value }); candidate.evidence.push({ field, sourceUrl, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) }); };
  add("startDate", range.startDate, range.excerpt); add("endDate", range.endDate, range.excerpt);
  const ticketsUrl = paleoTicketLink(html, source.url) ?? (isPaleoTicketUrl(source.url) ? source.url : undefined);
  if (ticketsUrl) add("ticketsUrl", ticketsUrl, "Official localized ticket landing page", ticketsUrl);
  // A future opening is unavailability now, not sold-out and not a generic
  // account/purchase link. Once that month arrives, stale copy proves nothing.
  for (const paragraph of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const value = text(paragraph[1]);
    const opening = value.match(/(?:The Christmas offer will open in|La billetterie de Noël ouvrira en)\s+([\p{L}]+)\s+(20\d{2})/iu);
    if (!opening || !ticketsUrl) continue;
    const month = months.findIndex(m => m.split("|").includes(opening[1].toLowerCase())) + 1;
    const year = Number(opening[2]);
    if (month && year >= range.year - 1 && year <= range.year && Date.parse(fetchedAt) < Date.UTC(year, month - 1, 1)) add("ticketStatus", "unavailable", value, ticketsUrl);
  }
  return candidate;
}
