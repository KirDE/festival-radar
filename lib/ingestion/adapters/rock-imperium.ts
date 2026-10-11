import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const festivalHost = "www.rockimperiumfestival.es";
const sellerHost = "www.madnesslive.es";
export const envelopeKind = "rock-imperium-linked-pass-v1";
export type PassDocument = { url: string; html: string };
export type PassEnvelope = { kind: typeof envelopeKind; home: string; documents: PassDocument[] };

export function isRockImperiumSource(source: FestivalSource): boolean {
  try {
    const url = new URL(source.url);
    return source.festivalSlug === "rock-imperium" && source.strategies.includes("html_fallback") &&
      url.protocol === "https:" && url.hostname === festivalHost && !url.port && !url.username && !url.password &&
      /^\/(?:es\/|en\/)?$/.test(url.pathname) && !source.fetchUrl && !source.followLinkPattern;
  } catch { return false; }
}

function clean(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}
function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;|&#38;/gi, "&").replace(/&#\d+;|&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}
function title(html: string): string { return text(clean(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""); }
function currentTitle(html: string, year: number): boolean {
  const t = title(html);
  return /\bRock Imperium Festival\b/i.test(t) && new RegExp(`\\b${year}\\b`).test(t) &&
    [...t.matchAll(/\b20\d{2}\b/g)].every(([y]) => Number(y) === year);
}
function sellerUrl(href: string, base: string): URL | undefined {
  try {
    const url = new URL(href.replace(/&amp;/gi, "&"), base);
    if (url.protocol === "https:" && url.hostname === sellerHost && !url.port && !url.username && !url.password && !url.search && !url.hash) return url;
  } catch { /* Invalid links are not evidence. */ }
  return undefined;
}
function links(html: string): { href: string; label: string }[] {
  return [...clean(html).matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ href: m[1] ?? m[2], label: text(m[3]) }));
}
function unique(values: string[]): string | undefined {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : undefined;
}
export function findRockImperiumLanding(html: string, source: FestivalSource): string | undefined {
  if (!currentTitle(html, source.editionYear)) return undefined;
  return unique(links(html).flatMap(({ href }) => {
    const url = sellerUrl(href, source.url);
    return url && new RegExp(`^/(?:es|en)/pagina/\\d+-rock-imperium-festival-${source.editionYear}/?$`).test(url.pathname) ? [url.href] : [];
  }));
}
export function findRockImperiumCategory(document: PassDocument, year: number): string | undefined {
  if (!currentTitle(document.html, year)) return undefined;
  return unique(links(document.html).flatMap(({ href, label }) => {
    const url = sellerUrl(href, document.url);
    return url && /comprar entradas|buy tickets/i.test(label) && new RegExp(`^/(?:es|en)/\\d+-rock-imperium-festival-${year}/?$`).test(url.pathname) ? [url.href] : [];
  }));
}
function generalPass(name: string, year: number): boolean {
  return new RegExp(`^Abono Rock Imperium Festival ${year}(?: \\(Cartagena\\))?$`, "i").test(name);
}
export function findRockImperiumProduct(document: PassDocument, year: number): string | undefined {
  return unique([...clean(document.html).matchAll(/<h[1-6]\b[^>]*class=["'][^"']*\bproduct-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .flatMap(m => links(m[1]).flatMap(({ href, label }) => {
      const url = sellerUrl(href, document.url);
      return url && generalPass(label, year) && new RegExp(`^/(?:es|en)/rock-imperium-festival-${year}/\\d+-(?:comprar-entrada|buy-tickets)-abono-rock-imperium-festival-${year}-cartagena\\.html$`).test(url.pathname) ? [url.href] : [];
    })));
}

export function extractRockImperiumCandidate(input: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  let home = input;
  let documents: PassDocument[] = [];
  if (input.startsWith('{"kind":')) {
    const envelope = JSON.parse(input) as PassEnvelope;
    if (envelope.kind === envelopeKind) { home = envelope.home; documents = envelope.documents; }
  }
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const add = (field: FieldEvidence["field"], value: string, document: PassDocument, excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: document.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  if (!currentTitle(home, source.editionYear)) {
    candidate.warnings.push("Rock Imperium homepage does not identify the requested edition");
    return candidate;
  }
  candidate.observedEditionYears = [source.editionYear];
  const months: Record<string, number> = { enero: 1, january: 1, febrero: 2, february: 2, marzo: 3, march: 3,
    abril: 4, april: 4, mayo: 5, may: 5, junio: 6, june: 6, julio: 7, july: 7, agosto: 8, august: 8,
    septiembre: 9, september: 9, octubre: 10, october: 10, noviembre: 11, november: 11, diciembre: 12, december: 12 };
  const date = title(home).match(/\b(\d{1,2})-(\d{1,2})-(\d{1,2})\s+([a-z]+)\s+(20\d{2})\b/i);
  const month = date && months[date[4].toLowerCase()];
  if (date && month && Number(date[5]) === source.editionYear) {
    const days = date.slice(1, 4).map(Number);
    const maxDay = new Date(Date.UTC(source.editionYear, month, 0)).getUTCDate();
    if (days.every(d => d >= 1 && d <= maxDay) && days[1] === days[0] + 1 && days[2] === days[1] + 1) {
      add("startDate", `${source.editionYear}-${String(month).padStart(2, "0")}-${String(days[0]).padStart(2, "0")}`, { url: source.url, html: home }, title(home));
      add("endDate", `${source.editionYear}-${String(month).padStart(2, "0")}-${String(days[2]).padStart(2, "0")}`, { url: source.url, html: home }, title(home));
    }
  }
  const landingUrl = findRockImperiumLanding(home, source);
  if (!landingUrl) { candidate.warnings.push("No unambiguous current Rock Imperium ticket gateway"); return candidate; }
  // Keep the independently reviewed official gateway, never stale /en/tickets/.
  add("ticketsUrl", source.url, { url: source.url, html: home }, `Current official ticket gateway links to ${landingUrl}`);
  const landing = documents.find(d => d.url === landingUrl);
  const categoryUrl = landing && findRockImperiumCategory(landing, source.editionYear);
  const category = documents.find(d => d.url === categoryUrl);
  const productUrl = category && findRockImperiumProduct(category, source.editionYear);
  const product = documents.find(d => d.url === productUrl);
  if (!product) { candidate.warnings.push("Current general-pass availability has not been verified"); return candidate; }
  const h1 = text(clean(product.html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  if (!generalPass(h1, source.editionYear)) { candidate.warnings.push("Linked Rock Imperium product is not the current general pass"); return candidate; }
  const form = clean(product.html).match(/<form\b[^>]*id=["']add-to-cart-or-refresh["'][^>]*>[\s\S]*?<\/form>/i)?.[0];
  const buttons = form && [...form.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].filter(m => /data-button-action=["']add-to-cart["']/i.test(m[1]));
  if (buttons?.length === 1 && !/\bdisabled(?:\s|=|$)|aria-disabled\s*=\s*["']true["']/i.test(buttons[0][1]) && /^(?:comprar(?: entradas?)?|buy(?: tickets?)?)$/i.test(text(buttons[0][2]))) {
    add("ticketStatus", "available", product, `${h1}: ${buttons[0][0]}`);
  } else {
    candidate.warnings.push("Current general-pass purchase is disabled or availability is unclear");
  }
  // No inferred billing/completeness or replacement lineup from first-round news.
  return candidate;
}
