import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const codePoint = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�";
const validDate = (value: string) => { const date = new Date(value + "T00:00:00Z"); return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value; };
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => codePoint(parseInt(n, 16))).replace(/\s+/g, " ").trim();

export function isPolandrockSource(source: FestivalSource): boolean {
  if (source.festivalSlug !== "polandrock") return false;
  const url = new URL(source.url);
  return url.origin === "https://polandrockfestival.pl" && source.strategies.includes("html_fallback") && !source.followLinkPattern;
}

/** Discover current-edition news, not an artist- or document-hash-pinned URL. */
export function polandrockAnnouncementUrl(html: string, source: FestivalSource): string | undefined {
  const page = clean(html);
  const edition = page.match(/\/header-(\d+)\.svg\b/i)?.[1];
  if (!edition) return undefined;
  for (const link of page.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(link[1].replace(/&amp;/gi, "&"), source.url);
      if (url.origin === "https://polandrockfestival.pl" && !url.username && !url.password && url.pathname.startsWith("/aktualnosci/") && new RegExp(`-${edition}-polandrock-festival/?$`, "i").test(url.pathname)) return url.href;
    } catch { /* Ignore malformed/off-site source links. */ }
  }
  return undefined;
}

export function extractPolandrockCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const page = clean(html);
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string, sourceUrl = source.url) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  // The official header countdown ties the current roster to an edition year.
  const counter = page.match(/<div\b[^>]*\bdata-counter\s*=\s*["'](20\d{2}-\d{2}-\d{2})\s+\d{2}:\d{2}["'][^>]*>/i);
  if (!counter || !validDate(counter[1])) {
    candidate.warnings.push("Pol'and'Rock current edition countdown is missing or invalid");
    return candidate;
  }
  candidate.observedEditionYears.push(Number(counter[1].slice(0, 4)));
  if (candidate.observedEditionYears[0] !== source.editionYear) {
    candidate.warnings.push("Pol'and'Rock countdown does not match source edition");
    return candidate;
  }
  add("startDate", counter[1], counter[0]);
  // Never flatten carousel descriptions/stage labels/news into artist identities.
  const carousel = page.match(/<section\b[^>]*\bid\s*=\s*["']artistsCarousel["'][^>]*>([\s\S]*?)<\/section>/i);
  const names: string[] = [];
  for (const card of (carousel?.[1] ?? "").matchAll(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bartists-carousel__item\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    if (!/<a\b[^>]*\bhref\s*=\s*["']\/program\?event_id=\d+["']/i.test(card[1])) continue;
    const heading = card[1].match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bartists-carousel__heading\b[^"']*["'][^>]*>\s*<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    const name = heading ? text(heading[1]) : "";
    if (!name || name.length > 120 || /[<>]|&[a-z]+;/i.test(name)) continue;
    if (!names.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
  }
  if (names.length) {
    add("lineup", names, carousel![0]);
    add("status", "partial", carousel![0]);
    // Duża Scena (main stage) is not headliner billing. Omit, don't clear it.
  }
  const announcement = page.match(/<template\b[^>]*\bdata-pnr-announcement-source\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/template>/i);
  if (announcement) {
    let url: URL;
    try { url = new URL(decodeURIComponent(announcement[1])); } catch { candidate.warnings.push("Pol'and'Rock announcement provenance is invalid"); return candidate; }
    if (url.origin !== "https://polandrockfestival.pl" || !url.pathname.startsWith("/aktualnosci/")) {
      candidate.warnings.push("Pol'and'Rock announcement provenance is not official"); return candidate;
    }
    const dates = [...announcement[2].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => text(p[1]).match(/\bW dniach\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})\.(\d{2})\.(20\d{2})\s+roku\b/i)).filter((m) => m !== null);
    const date = dates[0];
    if (date) {
      const start = `${date[4]}-${date[3]}-${date[1].padStart(2, "0")}`;
      const end = `${date[4]}-${date[3]}-${date[2].padStart(2, "0")}`;
      if (dates.length !== 1 || start !== counter[1] || end < start || !validDate(end)) candidate.warnings.push("Pol'and'Rock announcement dates conflict with current countdown");
      else { add("startDate", start, date[0], url.href); add("endDate", end, date[0], url.href); }
    }
  }
  return candidate;
}
