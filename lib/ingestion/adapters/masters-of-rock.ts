import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, code: string) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : _).replace(/&#x([\da-f]+);/gi, (_, code: string) => Number.parseInt(code, 16) <= 0x10ffff ? String.fromCodePoint(Number.parseInt(code, 16)) : _).replace(/&#39;|&apos;/gi, "'").replace(/&#160;|&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(value => value !== undefined);
const hasClass = (tag: string, name: string) => attr(tag, "class")?.split(/\s+/).includes(name);

/** Evergreen edition-scoped artist markers, not headings, news or a featured-card subset. */
export function extractMastersOfRockCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const heroes = [...clean.matchAll(/<aside\b([^>]*)>([\s\S]*?)<\/aside>/gi)].filter(m => hasClass(m[1], "mor-hero-side"));
  const hero = heroes.length === 1 && attr(heroes[0][1], "data-mor-state") === "active" ? heroes[0][2] : undefined;
  const dateBlock = hero?.match(/<div\b[^>]*class=["'][^"']*\bmor-hero-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const date = dateBlock && text(dateBlock).match(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\.(\d{2})\.(20\d{2})\b/);
  const editionLabel = hero && text(hero.split(/<p\b/i)[0]).match(/\b(20\d{2})\s*[–—-]\s*\d+\.\s*ročník\b/iu);
  if (!hero || !date || !editionLabel || editionLabel[1] !== date[4]) {
    candidate.warnings.push("Masters of Rock current edition hero/date could not be verified");
    return candidate;
  }
  const year = Number(date[4]);
  candidate.observedEditionYears = [year];
  if (year !== source.editionYear) {
    candidate.warnings.push(`Masters of Rock edition ${year} does not match configured edition ${source.editionYear}`);
    return candidate;
  }
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  const dates = [date[1], date[2]].map(day => `${year}-${date[3]}-${day.padStart(2, "0")}`);
  if (dates.some(value => !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) || dates[0] > dates[1]) {
    candidate.warnings.push("Masters of Rock hero contains invalid festival dates");
    return candidate;
  }
  add("startDate", dates[0], dateBlock!);
  add("endDate", dates[1], dateBlock!);
  const lineupBlocks = [...hero.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)].filter(m => hasClass(m[1], "mor-hero-lineup"));
  const names = lineupBlocks.length === 1 ? [...lineupBlocks[0][2].matchAll(/<span\b[^>]*\bdata-mor-band(?=\s|=|>)[^>]*>([\s\S]*?)<\/span>/gi)].map(m => text(m[1])).filter(Boolean) : [];
  if (names.length && names.every(name => name.length <= 100)) {
    add("lineup", [...new Map(names.map(name => [name.toLocaleLowerCase(), name])).values()], lineupBlocks[0][0]);
    // Announcement/featured order is not a festival headliner division or a full-bill claim.
    add("status", "partial", lineupBlocks[0][0]);
  } else candidate.warnings.push("Masters of Rock explicitly marked current artist list is missing or ambiguous");

  const ticketLinks = [...hero.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m => /koupit\s+vstupenky/iu.test(text(m[2])));
  for (const link of ticketLinks) {
    try {
      const url = new URL(attr(link[1], "href") ?? "", source.url);
      if (url.protocol !== "https:" || url.origin !== new URL(source.url).origin || !/^\/(?:cs|en)\/masters-of-rock-vstupenky\/?$/.test(url.pathname) || url.search || url.hash) continue;
      add("ticketsUrl", url.href, link[0]);
      break;
    } catch { /* Invalid or non-festival links are not ticket evidence. */ }
  }
  // A dated price deadline ("nebo vyprodání") is not a sold-out declaration.
  // Require a live purchase link in the standing/full-pass card for this edition.
  const cards = [...clean.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)].filter(m => hasClass(m[1], "mor-price-card"));
  for (const card of cards) {
    if (!/(?:^|\s)Na stání(?:\s|$)/iu.test(text(card[2])) || !/\b4 dny\b/iu.test(text(card[2])) || /vyprodáno|sold\s*out/iu.test(text(card[2]))) continue;
    for (const link of card[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      if (/\bdisabled\b|aria-disabled\s*=\s*["']true/i.test(link[1]) || !/koupit\s+vstupenku/iu.test(text(link[2]))) continue;
      try {
        const url = new URL(attr(link[1], "href") ?? "", source.url);
        if (url.protocol === "https:" && url.origin === new URL(source.url).origin && url.pathname === `/cs/koncerty/${year}-masters-of-rock` && !url.search && !url.hash) add("ticketStatus", "available", card[0]);
      } catch { /* Not a current festival purchase link. */ }
    }
  }
  return candidate;
}
