import { INGESTION_SCHEMA_VERSION, type FestivalCandidate, type FestivalSource, type FieldEvidence } from "../types.ts";

const origin = "https://www.frequency.at";
const ticketsUrl = origin + "/tickets/";
const months: Record<string, string> = { januar: "01", january: "01", februar: "02", february: "02", märz: "03", march: "03", april: "04", mai: "05", may: "05", juni: "06", june: "06", juli: "07", july: "07", august: "08", september: "09", oktober: "10", october: "10", november: "11", dezember: "12", december: "12" };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();

export function isFrequencySource(source: FestivalSource): boolean {
  try { const url = new URL(source.url); return source.festivalSlug === "frequency" && url.origin === origin && !url.username && !url.password && !url.search && !url.hash && ["/", "/tickets/", "/tickets"].includes(url.pathname); } catch { return false; }
}

export function frequencyTicketLink(html: string): boolean {
  return [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].some((match) => {
    try { const url = new URL(match[1], origin); return url.origin === origin && /^\/tickets\/?$/.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
  });
}

// Private in-process transport, not persisted catalog data or scraped instructions.
export function frequencyDocuments(home: string, tickets: string): string {
  return JSON.stringify({ frequencyDocuments: 1, home, tickets });
}

export function extractFrequencyCandidate(input: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isFrequencySource(source)) return undefined;
  let home = input, tickets = new URL(source.url).pathname === "/" ? "" : input;
  if (input.startsWith('{"frequencyDocuments":')) {
    const value = JSON.parse(input);
    if (value.frequencyDocuments !== 1 || typeof value.home !== "string" || typeof value.tickets !== "string") throw new Error("Invalid Frequency document transport");
    home = value.home; tickets = value.tickets;
  }
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const add = (field: FieldEvidence["field"], value: string, excerpt: string, sourceUrl = source.url) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  const title = text(home.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const date = title.match(/^Frequency Festival\s*\|\s*(\d{1,2})\.?\s*[-–—]\s*(\d{1,2})\.?\s+([\p{L}]+)\s+(20\d{2})\b/u);
  if (date) {
    candidate.observedEditionYears.push(Number(date[4]));
    const month = months[date[3].toLocaleLowerCase()];
    const start = `${date[4]}-${month}-${date[1].padStart(2, "0")}`, end = `${date[4]}-${month}-${date[2].padStart(2, "0")}`;
    if (Number(date[4]) === source.editionYear && month && Number(date[1]) <= Number(date[2]) && [start, end].every((day) => {
      const parsed = new Date(day); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
    })) { add("startDate", start, title); add("endDate", end, title); }
    else candidate.warnings.push("Frequency advertised dates do not match the configured edition or a valid range");
  }
  if (frequencyTicketLink(home) && candidate.startDate) add("ticketsUrl", ticketsUrl, "Official homepage links to /tickets/");
  // Only the standard full-festival admission Offer establishes availability.
  // Never treat VIP, parking, accommodation or stale CSS class years as the bill.
  for (const match of tickets.matchAll(/<li\b[^>]*class=["'][^"']*\bticket__excerpt\b[^"']*["'][^>]*>([\s\S]*?)<\/section>\s*<\/li>/gi)) {
    const card = match[1];
    const name = text(card.match(/<h2\b[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
    if (name !== `${source.editionYear} - Festivalpass`) continue;
    const label = text(card.match(/<h3\b[^>]*class=["']ticket__extratext["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const buy = [...card.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some((link) => {
      try { const url = new URL(link[1].replace(/&amp;/gi, "&")); return url.origin === "https://www.oeticket.com" && new RegExp(`\\b${source.editionYear}\\b`).test(url.pathname); } catch { return false; }
    });
    const price = /itemprop=["']price["']\s+content=["']€\s*\d+[,.]\d{2}["']/i.test(card);
    if (/^Jetzt (?:verfügbar|erhältlich)!?$/i.test(label) && buy && price) {
      add("ticketsUrl", ticketsUrl, name, ticketsUrl);
      add("ticketStatus", "available", `${name}: ${label}; priced oeticket purchase offer`, ticketsUrl);
      if (!candidate.observedEditionYears.includes(source.editionYear)) candidate.observedEditionYears.push(source.editionYear);
    } else candidate.warnings.push("Frequency standard festival pass has no verified live purchase offer; do not infer global sold-out status from one product");
  }
  // Deliberately omit lineup/status: current ticket/date evidence does not turn
  // last year's programme or a verified partial bill into an empty lineup.
  if (!candidate.evidence.length && !candidate.warnings.length) candidate.warnings.push("Frequency page exposes no supported current-edition fields");
  return candidate;
}
