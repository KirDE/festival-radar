import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ")
  .replace(/&#(?:0*38);|&amp;/gi, "&").replace(/&#(?:0*8211);|&ndash;/gi, "–")
  .replace(/&#(?:0*8212);|&mdash;/gi, "—").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

/** The live homepage has mixed editions and navigation inside its lineup wrappers.
 * Read only edition-bound metadata; absence is never an artist removal or a full bill.
 * Deliberately leave artist/billing reconciliation to a separately reviewed extractor.
 */
export function extractSummerBreezeCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt,
    evidence: [], warnings: [], observedEditionYears: [] };
  const add = (field: FieldEvidence["field"], value: string | undefined, excerpt: string) => {
    if (!value) return;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  // Unlabelled header times, not dates from news, retrospectives or the old day bill.
  const header = html.match(/<div\b[^>]*class=["'][^"']*\bheader__festival-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    ?? html.match(/<h1\b[^>]*class=["'][^"']*\bhomepage-headline\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const dates = [...(header ?? "").matchAll(/<time\b[^>]*datetime=["'](20\d{2}-\d{2}-\d{2})["'][^>]*>/gi)].map(m => m[1]);
  if (dates.length !== 2 || dates.some(d => Number(d.slice(0, 4)) !== source.editionYear || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) || dates[0] > dates[1]) {
    candidate.warnings.push("Summer Breeze header has no edition-matched date range");
    return candidate;
  }
  candidate.observedEditionYears = [source.editionYear];
  add("startDate", dates[0], header!);
  add("endDate", dates[1], header!);
  const editionTitle = new RegExp(`\\bSUMMER BREEZE(?: Open Air)?\\s+${source.editionYear}\\b`, "i");
  const headlines = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(m => ({ title: text(m[1]), markup: m[0] })).filter(h => editionTitle.test(h.title));
  // The homepage news list is newest first. Ignore concert retrospectives and
  // old-edition posts; a later complete-bill announcement supersedes first bands.
  const bill = headlines.find(h => /(?:erste[n]? bands|weitere bands|more bands|first bands|komplette[srn]? (?:line[ -]?up|programm)|vollständige[srn]? line[ -]?up|full line[ -]?up)/i.test(h.title));
  if (bill) add("status", /komplette|vollständige|full line/i.test(bill.title) ? "confirmed" : "partial", bill.markup);

  // Only current prominent sales statements count. An old news teaser or a
  // generic Tickets/Sichere-dir link is not live availability. Conflicts abstain.
  const sales = headlines.filter(h => /\bswiper-slide__headline\b/i.test(h.markup));
  const soldOut = sales.find(h => /ausverkauft|sold out/i.test(h.title));
  const onSale = sales.find(h => /(?:tage[s]?tickets|day tickets|festivaltickets|festival tickets).*(?:jetzt (?:erhältlich|verfügbar|im (?:vor)?verkauf)|now (?:available|on sale))/i.test(h.title));
  if (soldOut && !onSale) add("ticketStatus", "unavailable", soldOut.markup);
  if (onSale && !soldOut) add("ticketStatus", "available", onSale.markup);
  for (const link of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    try {
      const url = new URL(link[1], source.url);
      if (url.protocol === "https:" && /^(?:www\.)?summer-breeze\.de$/i.test(url.hostname) && /^\/(?:de|en)\/tickets\/$/i.test(url.pathname) && !url.search && !url.hash) {
        add("ticketsUrl", url.href, link[0]);
        break;
      }
    } catch { /* Not a trusted official ticket-information link. */ }
  }
  return candidate;
}
