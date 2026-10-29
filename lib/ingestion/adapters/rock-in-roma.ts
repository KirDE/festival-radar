import type { FestivalCandidate, FestivalSource } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

export function isRockInRomaSource(source: FestivalSource): boolean {
  const url = new URL(source.fetchUrl ?? source.url);
  return source.festivalSlug === "rock-in-roma" && url.origin === "https://rockinroma.com" &&
    (url.pathname === "/" || url.pathname === `/lineup-${source.editionYear}/`);
}

function decode(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}
function attr(tag: string, key: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decode(match[1] ?? match[2]) : undefined;
}
// Preserve mixed-case labels and initials, normalize shout-case words only.
function artistName(label: string): string {
  return label.split(" ").map((word, index) => {
    if (!/^[A-ZÀ-Ý]{3,}$/.test(word)) return word;
    const lower = word.toLocaleLowerCase();
    return index > 0 && ["and", "of", "featuring"].includes(lower) ? lower : word[0] + lower.slice(1);
  }).join(" ");
}

export const ROCK_IN_ROMA_DOCUMENTS = "rock-in-roma-concert-series-v1";
export type RockInRomaDocument = { url: string; html: string };

function lineupMain(html: string, year: number): string | undefined {
  const main = html.match(/<main\b[^>]*class=["'][^"']*\brir-lineup\b[^"']*["'][^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return Number(main?.match(/<h1\b[^>]*>\s*Lineup\s+(20\d{2})\s*<\/h1>/i)?.[1]) === year ? main : undefined;
}

export function rockInRomaConcerts(html: string, source: FestivalSource): {url: string; name: string}[] {
  const cards = new Map<string, {url: string; name: string}>();
  for (const match of (lineupMain(html, source.editionYear) ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!attr(match[1], "class")?.split(/\s+/).includes("rir-lineup__flyer")) continue;
    const href = attr(match[1], "href"), label = attr(match[1], "aria-label");
    if (!href || !label) continue;
    try {
      const url = new URL(href, source.url);
      if (url.origin !== "https://rockinroma.com" || url.username || url.password || !/^\/concerts\/[^/]+\/?$/.test(url.pathname) || url.search || url.hash) continue;
      cards.set(url.href, {url: url.href, name: artistName(label)});
    } catch { continue; }
  }
  return [...cards.values()];
}

function concertDate(html: string, name: string, year: number): string | undefined {
  // Only the concert heading owns the date. Footer copyright, news, on-sale
  // dates and old editorial prose must not become the concert's schedule.
  const headings = [...html.matchAll(/<section\b[^>]*class=["'][^"']*\brir-concert__heading\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi)];
  const heading = headings.length === 1 ? headings[0][1] : undefined;
  const title = heading?.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
  if (!heading || !title || artistName(decode(title.replace(/<[^>]*>/g, " "))).toLocaleLowerCase() !== name.toLocaleLowerCase()) return undefined;
  const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const dates = new Set<string>();
  for (const match of heading.matchAll(/<div\b[^>]*class=["'][^"']*\brir-concert-information\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const date = decode(match[1].replace(/<[^>]*>/g, " ")).toLocaleLowerCase().match(/^(\d{1,2}) ([a-z]+) (20\d{2})$/);
    if (!date) continue;
    const month = months.indexOf(date[2]) + 1;
    const iso = `${date[3]}-${String(month).padStart(2, "0")}-${date[1].padStart(2, "0")}`;
    if (Number(date[3]) !== year || !month || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso) return undefined;
    dates.add(iso);
  }
  return dates.size === 1 ? [...dates][0] : undefined;
}

export function extractRockInRomaCandidate(input: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isRockInRomaSource(source)) return undefined;
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  let html = input, documents: RockInRomaDocument[] | undefined;
  if (input.trimStart().startsWith("{")) {
    try {
      const envelope = JSON.parse(input);
      if (envelope.kind !== ROCK_IN_ROMA_DOCUMENTS || typeof envelope.lineup !== "string" || !Array.isArray(envelope.concerts) || envelope.concerts.some((d: RockInRomaDocument) => !d || typeof d.url !== "string" || typeof d.html !== "string")) throw new Error("Invalid documents");
      html = envelope.lineup; documents = envelope.concerts;
    } catch { candidate.warnings.push("Rock in Roma concert documents are invalid"); return candidate; }
  }
  const lineupUrl = new URL(`/lineup-${source.editionYear}/`, source.url).href;
  if (!lineupMain(html, source.editionYear)) {
    candidate.warnings.push("Rock in Roma current-edition lineup grid was not found");
    const year = html.match(/<h1\b[^>]*>\s*Lineup\s+(20\d{2})\s*<\/h1>/i)?.[1];
    if (year) candidate.observedEditionYears.push(Number(year));
    return candidate;
  }
  candidate.observedEditionYears = [source.editionYear];
  const concerts = rockInRomaConcerts(html, source);
  if (!concerts.length) { candidate.warnings.push("Rock in Roma current lineup grid has no supported concert cards"); return candidate; }
  candidate.artistListMode = "additive";
  candidate.lineup = [...new Map(concerts.map(c => [c.name.toLocaleLowerCase(), c.name])).values()];
  candidate.evidence.push({field: "lineup", sourceUrl: lineupUrl, observedAt: fetchedAt, excerpt: concerts.map(c => c.name).join(" | ").slice(0, 500)});
  // The official festival-wide ticket CTA, not a lineup page or a single
  // performer's product. A link alone does not establish on-sale status.
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!attr(match[1], "class")?.split(/\s+/).includes("rir-footer__ticket")) continue;
    const href = attr(match[1], "href");
    if (href === "https://www.ticketone.it/artist/rock-in-roma/") {
      candidate.ticketsUrl = href;
      candidate.evidence.push({field: "ticketsUrl", sourceUrl: lineupUrl, observedAt: fetchedAt, excerpt: match[0].slice(0, 500)});
    }
  }
  if (documents) {
    const dates = concerts.map(c => {
      const docs = documents!.filter(d => d.url === c.url);
      return {...c, date: docs.length === 1 ? concertDate(docs[0].html, c.name, source.editionYear) : undefined};
    });
    if (dates.some(d => !d.date)) candidate.warnings.push("Rock in Roma concert-series dates require a valid current-edition date for every linked concert");
    else {
      const ordered = dates.sort((a, b) => a.date!.localeCompare(b.date!));
      candidate.startDate = ordered[0].date; candidate.endDate = ordered.at(-1)!.date;
      for (const [field, concert] of [["startDate", ordered[0]], ["endDate", ordered.at(-1)!]] as const)
        candidate.evidence.push({field, sourceUrl: concert.url, observedAt: fetchedAt, excerpt: `${concert.name}: ${concert.date} (boundary of currently announced concert series)`});
    }
  }
  return candidate;
}
