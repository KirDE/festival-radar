import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import { validateGenericLineup } from "../lineup-quality.ts";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function date(day: string, month: string, year: number): string | undefined {
  const value = `${year}-${String(months.indexOf(month.toLowerCase()) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/** The lineup wrapper also holds ticket promotions. Never treat its text as artists. */
export function extractResurrectionCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [],
  };
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  // The edition-specific branded heading is authoritative; stale SEO copy and
  // Route Resurrection news dates elsewhere on the same homepage are not.
  const ranges: { start: string; end: string; year: number; excerpt: string }[] = [];
  for (const heading of clean.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const value = text(heading[1]);
    const brand = value.match(/^Resurrection Fest(?:\s+(?:EG|Estrella Galicia))?\s+(20\d{2})\b/i);
    const range = value.match(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s*[-–—]\s*(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(20\d{2})\b/i);
    if (!brand || !range || brand[1] !== range[5]) continue;
    const year = Number(range[5]);
    candidate.observedEditionYears.push(year);
    const start = date(range[1], range[2], year), end = date(range[3], range[4], year);
    if (start && end && end >= start && Date.parse(end) - Date.parse(start) <= 14 * 86400000) ranges.push({ start, end, year, excerpt: heading[0] });
  }
  candidate.observedEditionYears = [...new Set(candidate.observedEditionYears)];
  const currentRanges = ranges.filter(({ year }) => year === source.editionYear);
  if (!currentRanges.length || new Set(currentRanges.map(({ start, end }) => `${start}/${end}`)).size !== 1) {
    candidate.warnings.push("Resurrection homepage has no unambiguous current-edition festival date heading");
    return candidate;
  }
  add("startDate", currentRanges[0].start, currentRanges[0].excerpt);
  add("endDate", currentRanges[0].end, currentRanges[0].excerpt);
  for (const link of clean.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(link[1].replace(/&amp;/gi, "&"), source.url); } catch { continue; }
    if (url.origin === new URL(source.url).origin && /^\/entradas\/?$/.test(url.pathname) && /^(tickets|entradas)$/i.test(text(link[2]))) {
      add("ticketsUrl", url.href, link[0]);
      break;
    }
  }
  // Only individual performer markup inside the festival section, never Route
  // tour/news cards or generic headings. An image alone remains reviewable.
  const section = clean.match(/<section\b[^>]*\bid=["']lineup["'][^>]*>([\s\S]*?)<\/section>/i)?.[1];
  if (section) {
    const names: string[] = [];
    for (const artist of section.matchAll(/<([a-z][\w:-]*)\b[^>]*\bdata-artist=["']([^"']+)["'][^>]*>[\s\S]*?<\/\1>/gi)) names.push(text(artist[2]));
    for (const artist of section.matchAll(/<([a-z][\w:-]*)\b[^>]*\bitemprop=["']performer["'][^>]*>([\s\S]*?)<\/\1>/gi)) names.push(text(artist[2]));
    const quality = validateGenericLineup(names);
    candidate.warnings.push(...quality.warnings);
    if (quality.names.length) add("lineup", quality.names, section);
    // Exhaustion of one tranche says nothing about whole-event availability.
    // Known ticket placeholder is a successful unchanged-facts check, not failure.
    const ticketPlaceholder = /\b(?:early bird|tickets?|entradas|abonos)\b[^<]{0,80}\b(?:sold out|agotad[oa]s?)\b/i.test(text(section));
    const unknownImage = [...section.matchAll(/<img\b[^>]*>/gi)].some(([tag]) => {
      if (/alt=["'][^"']*background/i.test(tag)) return false;
      const paths = [...tag.matchAll(/(?:src|data-lazy-src)=["']([^"']+)["']/gi)].map((match) => match[1]).filter((path) => !path.startsWith("data:"));
      return paths.some((path) => !/early[-_]?birds?|tickets[-_]?sold[-_]?out/i.test(path));
    });
    if (!names.length && /<img\b/i.test(section) && (!ticketPlaceholder || unknownImage)) {
      candidate.warnings.push("Resurrection festival lineup image requires review: no individual performer markup");
    }
  }
  return candidate;
}
