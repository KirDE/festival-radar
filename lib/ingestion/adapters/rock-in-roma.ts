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

export function extractRockInRomaCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isRockInRomaSource(source)) return undefined;
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const main = html.match(/<main\b[^>]*class=["'][^"']*\brir-lineup\b[^"']*["'][^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const year = main?.match(/<h1\b[^>]*>\s*Lineup\s+(20\d{2})\s*<\/h1>/i)?.[1];
  if (!main || Number(year) !== source.editionYear) {
    candidate.warnings.push("Rock in Roma current-edition lineup grid was not found");
    if (year) candidate.observedEditionYears.push(Number(year));
    return candidate;
  }
  candidate.observedEditionYears = [Number(year)];
  const names = new Map<string, string>();
  let excerpt = "";
  for (const match of main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!attr(match[1], "class")?.split(/\s+/).includes("rir-lineup__flyer")) continue;
    const href = attr(match[1], "href"), label = attr(match[1], "aria-label");
    if (!href || !label) continue;
    try {
      const url = new URL(href, source.url);
      if (url.origin !== "https://rockinroma.com" || !/^\/concerts\/[^/]+\/?$/.test(url.pathname) || url.search || url.hash) continue;
    } catch { continue; }
    const name = artistName(label);
    names.set(name.toLocaleLowerCase(), name);
    if (!excerpt) excerpt = match[0].slice(0, 500);
  }
  if (!names.size) { candidate.warnings.push("Rock in Roma current lineup grid has no supported concert cards"); return candidate; }
  candidate.artistListMode = "additive";
  candidate.lineup = [...names.values()];
  // Individually dated concerts neither establish a festival date span nor
  // designate festival headliners or prove current ticket availability.
  candidate.ticketsUrl = new URL(`/lineup-${source.editionYear}/`, source.url).href;
  for (const field of ["lineup", "ticketsUrl"] as const) candidate.evidence.push({field, sourceUrl: candidate.ticketsUrl, observedAt: fetchedAt, excerpt});
  return candidate;
}
