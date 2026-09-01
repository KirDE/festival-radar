import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

type AdapterResult = { startDate?: string; endDate?: string; city?: string; excerpt: string };

const months: Record<string, string> = { januari: "01", februari: "02", maart: "03", april: "04", mei: "05", juni: "06", juli: "07", augustus: "08", september: "09", oktober: "10", november: "11", december: "12" };
const pad = (value: string) => value.padStart(2, "0");

function pinkpop(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})\s*[•·]\s*(\d{1,2})\s*[•·]\s*(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/i);
  if (!date) return undefined;
  const location = html.match(/class=["'][^"']*location[^"']*["'][^>]*>[\s\S]{0,200}?<strong[^>]*>[^<]+<\/strong>\s*([^<]+)/i);
  return { startDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[1])}`, endDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[3])}`, city: location?.[1].trim(), excerpt: date[0] };
}

function tuska(html: string): AdapterResult | undefined {
  const date = html.match(/Tuska Festival\s*[-–—]\s*(\d{1,2})\.[–-](\d{1,2})\.(\d{1,2})\.(20\d{2})/i);
  if (!date) return undefined;
  return { startDate: `${date[4]}-${pad(date[3])}-${pad(date[1])}`, endDate: `${date[4]}-${pad(date[3])}-${pad(date[2])}`, excerpt: date[0] };
}

function trees(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})(?:st|nd|rd|th)\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if (!date) return undefined;
  const month = String(new Date(`${date[3]} 1, 2000`).getUTCMonth() + 1).padStart(2, "0");
  return { startDate: `${date[4]}-${month}-${pad(date[1])}`, endDate: `${date[4]}-${month}-${pad(date[2])}`, excerpt: date[0] };
}

function tolminator(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})\s+July\s*[-–—]\s*(\d{1,2})\s+August\s+(20\d{2})/i);
  if (!date) return undefined;
  return { startDate: `${date[3]}-07-${pad(date[1])}`, endDate: `${date[3]}-08-${pad(date[2])}`, excerpt: date[0] };
}

function leyendas(html: string): AdapterResult | undefined {
  const title = html.match(/<title[^>]*>[\s\S]*?Leyendas del Rock\s+(20\d{2})[\s\S]*?<\/title>/i);
  return title ? { excerpt: title[0].replace(/<[^>]+>/g, " ").trim() } : undefined;
}

const adapters: Record<string, (html: string) => AdapterResult | undefined> = { "2000trees": trees, "pinkpop": pinkpop, "tuska": tuska, "tolminator": tolminator, "leyendas-del-rock": leyendas };

export function extractOfficialMarkupCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const result = adapters[source.festivalSlug]?.(html);
  if (!result) {
    candidate.warnings.push(`Official markup adapter found no trustworthy fields for ${source.festivalSlug}`);
    return candidate;
  }
  if (result.startDate) candidate.observedEditionYears.push(Number(result.startDate.slice(0, 4)));
  for (const field of ["startDate", "endDate", "city"] as const) {
    const value = result[field];
    if (!value) continue;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field: field as FieldEvidence["field"], sourceUrl: source.url, observedAt: fetchedAt, excerpt: result.excerpt.slice(0, 500) });
  }
  if (!candidate.evidence.length) candidate.warnings.push("Official title confirms the current edition but exposes no supported structured field");
  return candidate;
}
