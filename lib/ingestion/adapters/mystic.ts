import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/\s+/g, " ").trim();
const href = (tag: string) => tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];

// This source uses adjacent artist anchors, NOT a single performer. Its SEO
// describes last year's event; only the visible current event dates bind the bill.
export function extractMysticCandidate(document: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const c: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const reject = (reason: string) => { c.warnings.push(reason); return c; };
  const url = new URL(source.url);
  if (url.protocol !== "https:" || !/^(?:www\.)?mysticfestival\.pl$/.test(url.hostname) || url.pathname !== "/")
    return reject("Mystic extraction requires the official festival home");
  const html = document.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const headings = [...html.matchAll(/<(?:span|h[1-6])\b[^>]*\bclass=["'][^"']*\belementor-heading-title\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|h[1-6])>/gi)].map(m => plain(m[1]));
  const dates = headings.flatMap(text => [...text.matchAll(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\.(\d{2})\.(20\d{2})\b/g)]);
  const ranges = [...new Set(dates.map(m => `${m[4]}-${m[3]}-${m[1].padStart(2, "0")}/${m[4]}-${m[3]}-${m[2].padStart(2, "0")}`))];
  if (ranges.length !== 1 || Number(dates[0]?.[4]) !== source.editionYear)
    return reject("Mystic visible event date is missing, ambiguous or belongs to another edition");
  const [startDate, endDate] = ranges[0].split("/");
  if ([startDate, endDate].some(d => !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) || startDate > endDate)
    return reject("Mystic visible event date range is invalid");
  c.observedEditionYears = [source.editionYear];
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => {
    Object.assign(c, { [field]: value });
    c.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  add("startDate", startDate, dates[0][0]); add("endDate", endDate, dates[0][0]);
  const blocks = [...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bband_list\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
  const names: string[] = [];
  for (const block of blocks) for (const a of block[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const link = href(a[0]); if (!link) continue;
    let target: URL; try { target = new URL(link, source.url); } catch { continue; }
    if (target.protocol !== "https:" || !/^(?:www\.)?mysticfestival\.pl$/.test(target.hostname) || !/^\/artist\/[^/]+\/$/.test(target.pathname)) continue;
    const name = plain(a[1]);
    if (name && !names.some(n => n.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
  }
  const banners = [...html.matchAll(/<span\b[^>]*\bclass=["'][^"']*\belementor-icon-box-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map(m => plain(m[1]));
  const headliners = names.filter(name => banners.some(text => {
    const index = text.toLocaleLowerCase().indexOf(name.toLocaleLowerCase());
    return index >= 0 && !/[\p{L}\p{N}]/u.test(text[index - 1] ?? "") && /^\s+(?:(?:pierwszym|kolejnym)\s+)?headlinerem\b/i.test(text.slice(index + name.length));
  }));
  if (names.length && headliners.length) {
    add("headliners", headliners, banners.join("; "));
    add("lineup", names.filter(name => !headliners.includes(name)), blocks[0][0]);
    // A list of first announcements is not a complete festival bill.
    const complete = headings.some(text => text === `Pełny skład Mystic Festival ${source.editionYear}` || text === `Mystic Festival ${source.editionYear} full line-up`);
    add("status", complete ? "confirmed" : "partial", complete ? headings.join("; ") : banners.join("; "));
  } else c.warnings.push("Mystic current artist list or explicit headliner billing is missing");
  const purchase = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].find(a => {
    const link = href(a[0]); if (!link) return false;
    let target: URL; try { target = new URL(link, source.url); } catch { return false; }
    return target.protocol === "https:" && target.hostname === "tickets.mysticfestival.pl" &&
      plain(a[1]).includes(`Mystic Festival ${source.editionYear}`) && /Kup bilet/i.test(plain(a[1]));
  });
  if (purchase) {
    // Catalogue policy uses the already trusted festival home as gateway, not
    // an unconfigured ticket host; no provider or source configuration writes.
    add("ticketsUrl", url.origin + "/", purchase[0]);
    if (banners.some(text => /bilety\b[^.!]*\bwyprzedane\b/i.test(text))) add("ticketStatus", "sold_out", banners.join("; "));
    else if (banners.some(text => /bilety\b[^.!]*\b(?:już\s+)?w sprzedaży\b/i.test(text))) add("ticketStatus", "available", banners.join("; "));
  }
  return c;
}
