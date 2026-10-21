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
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;|&#38;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#(\d+);/g, (_, n) => { const code = Number(n); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " "; }).replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
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
    // The official gateway may bypass the promoter page and link directly to
    // its current ticket category. Both routes retain the same seller/year gate.
    return url && new RegExp(`^/(?:es|en)/(?:pagina/)?\\d+-rock-imperium-festival-${source.editionYear}/?$`).test(url.pathname) ? [url.href] : [];
  }));
}
export function findRockImperiumCategory(document: PassDocument, year: number): string | undefined {
  if (!currentTitle(document.html, year)) return undefined;
  const current = sellerUrl(document.url, document.url);
  if (current && new RegExp(`^/(?:es|en)/\\d+-rock-imperium-festival-${year}/?$`).test(current.pathname)) return current.href;
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

// The live linked promoter keeps a textual first-wave announcement even when
// the official homepage bill is image-only. Read sentence subjects, not every
// name mentioned in history/tribute prose, and never reuse older festival news.
const announcementMarker = /(?:primera|nueva) (?:ronda|tanda) de confirmaciones|(?:first|new) (?:wave|round) of confirmations/i;

function announcedArtists(document: PassDocument, year: number): string[] | undefined {
  if (!currentTitle(document.html, year)) return undefined;
  const html = clean(document.html).replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => text(m[1]));
  const blocks = paragraphs.filter(p => announcementMarker.test(p));
  const artistParagraphs = paragraphs.filter(p => !/^(?:Ticket information|Información entradas)\s*:/i.test(p));
  if (blocks.length !== 1 || /cancelación|retirada|no actuar[aá]|sustituye|baja del cartel|cancelled|canceled|withdrawn|will not perform|replaces/i.test(artistParagraphs.join(" "))) return undefined;
  const block = blocks[0];
  if ([...block.matchAll(/\b20\d{2}\b/g)].some(([y]) => Number(y) !== year)) return undefined;
  const names: string[] = [];
  for (const sentence of block.split(/\.\s+/)) {
    // Each supported grammar identifies the performing subject explicitly.
    // Appositions and contextual tribute names must never enter the bill.
    const name = sentence.match(/^Como gran cabeza de este (?:primer|nuevo) anuncio, (.+?) llegar[aá] a Rock Imperium\b/i)?.[1]
      ?? sentence.match(/^(.+?) (?:rendir[aá] homenaje|llegar[aá] a Rock Imperium)\b/i)?.[1]
      ?? sentence.match(/^([^,]+), [^,]+, ofrecer[aá]n?\b/i)?.[1]
      ?? sentence.match(/^As the (?:major )?headliner of this (?:first|new) announcement, (.+?) will arrive at Rock Imperium\b/i)?.[1]
      ?? sentence.match(/^(.+?) will (?:pay tribute|arrive at Rock Imperium)\b/i)?.[1]
      ?? sentence.match(/^([^,]+), (?:worldwide )?standard-bearers of [^,]+$/i)?.[1]
      ?? sentence.match(/^Completing this (?:first|new) round of confirmations (?:is|are) ([^,]+),/i)?.[1]
      ?? sentence.match(/^Completa(?:n)? esta (?:primera|nueva) ronda de confirmaciones ([^,]+),/i)?.[1];
    if (name !== undefined) names.push(name.trim());
  }
  if (!names.length || names.length > 50 || names.some(name => name.length > 100 ||
    !/^[\p{Lu}\d][\p{L}\p{N} &'’$!+().-]*$/u.test(name) ||
    /^(?:La formación|El festival|The (?:most|band|festival)|Como|Completa|Después|As the|Completing|After)\b/i.test(name) || /\b20\d{2}\b/.test(name)) ||
    new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) return undefined;
  return names;
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
  if (landing && announcementMarker.test(text(clean(landing.html)))) {
    const names = announcedArtists(landing, source.editionYear);
    if (names) {
      candidate.lineup = names;
      candidate.lineupScope = "announcement";
      candidate.status = "partial";
      const excerpt = `Current linked first-wave announcement: ${names.join(", ")}`;
      for (const field of ["lineup", "status"] as const)
        candidate.evidence.push({ field, sourceUrl: landing.url, observedAt: fetchedAt, excerpt });
    } else candidate.warnings.push("Current Rock Imperium announcement is ambiguous or contains cancellation/replacement language");
  }
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
  // Unranked first-wave subjects are additive; never replace billing or remove absent acts.
  return candidate;
}
