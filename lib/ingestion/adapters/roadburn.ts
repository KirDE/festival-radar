import { INGESTION_SCHEMA_VERSION, type FestivalCandidate, type FestivalSource, type FieldEvidence } from "../types.ts";

const origin = "https://roadburn.com";
export const ROADBURN_ARTIST_REVIEW = "New Roadburn announcement artists require independent review before provider activity";
export type RoadburnDocument = { url: string; html: string };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;|&#0*38;/gi, "&").replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, hex, dec) => {
  const code = parseInt(hex ?? dec, hex ? 16 : 10); return code <= 0x10ffff ? String.fromCodePoint(code) : "";
}).replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/\s+/g, " ").trim();
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
  .replace(/<([a-z][a-z0-9]*)\b(?=[^>]*(?:\shidden(?:\s|>|=)|aria-hidden=["']true["']|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1>/gi, "");
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameValid = (name: string) => name.length > 0 && name.length <= 100 && !/\b(?:tickets?|line.?up|festival|artwork|exhibition|podcast|20\d{2})\b/i.test(name);

export function roadburnUrl(href: string, base = origin): string | undefined {
  try { const url = new URL(text(href), base); return url.origin === origin && !url.username && !url.password && !url.search && !url.hash && /^\/[a-z0-9%-]*\/?$/i.test(url.pathname) ? url.href : undefined; } catch { return undefined; }
}
export function isRoadburnSource(source: FestivalSource): boolean {
  return source.festivalSlug === "roadburn" && roadburnUrl(source.url) === origin + "/" && source.strategies.includes("html_fallback");
}
export function roadburnLinked(html: string, path: string): boolean {
  return [...clean(html).matchAll(/<a\b([^>]*)>/gi)].some(m => roadburnUrl(attr(m[1], "href") ?? "") === origin + path);
}
// News headings, not the archived /band/ inventory. Discover actual URLs, never
// freeze artist names or require a reviewed document hash to recognize updates.
export function discoverRoadburnAnnouncements(html: string, year: number): string[] {
  const urls = new Set<string>();
  for (const m of clean(html).matchAll(/<h[23]\b([^>]*)>([\s\S]*?)<\/h[23]>/gi)) {
    if (!attr(m[1], "class")?.split(/\s+/).includes("t-entry-title")) continue;
    const a = m[2].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = text(a[2]);
    if ((title.match(/\b20\d{2}\b/g) ?? []).some(y => Number(y) !== year)) continue;
    if (!/line-up|announced|returns? to Roadburn/i.test(title) || /ticket|artwork|exhibition|podcast|side programme/i.test(title)) continue;
    const url = roadburnUrl(attr(a[1], "href") ?? "");
    if (url && url !== origin + "/" && url !== origin + "/news/") urls.add(url);
  }
  if (urls.size > 20) throw new Error("Roadburn announcement discovery exceeded its bounded document limit");
  return [...urls];
}
export function roadburnDocuments(home: string, documents: RoadburnDocument[], tickets = ""): string {
  return JSON.stringify({ roadburnDocuments: 1, home, documents, tickets });
}

export function extractRoadburnCandidate(input: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isRoadburnSource(source)) return undefined;
  let home = input, documents: RoadburnDocument[] = [], tickets = "";
  if (input.startsWith('{"roadburnDocuments":')) {
    const data = JSON.parse(input);
    if (data.roadburnDocuments !== 1 || typeof data.home !== "string" || typeof data.tickets !== "string" || !Array.isArray(data.documents) || data.documents.length > 20 || data.documents.some((d: RoadburnDocument) => typeof d.html !== "string" || !roadburnUrl(d.url))) throw new Error("Invalid Roadburn document transport");
    home = data.home; documents = data.documents; tickets = data.tickets;
  }
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string, url = source.url) => {
    Object.assign(candidate, { [field]: value }); candidate.evidence.push({ field, sourceUrl: url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  const visible = text(clean(home));
  const date = visible.match(/The festival will take place in,?\s+Tilburg, The Netherlands between ([A-Za-z]+) (\d{1,2})[-–—](\d{1,2}), (20\d{2})\b/i);
  if (date) {
    const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(date[1].toLowerCase()) + 1;
    const days = [date[2], date[3]].map(day => `${date[4]}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`);
    candidate.observedEditionYears.push(Number(date[4]));
    if (Number(date[4]) === source.editionYear && month && Number(date[2]) <= Number(date[3]) && days.every(day => { const d = new Date(day); return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === day; })) {
      add("startDate", days[0], date[0]); add("endDate", days[1], date[0]);
      if (roadburnLinked(home, "/tickets/")) add("ticketsUrl", origin + "/tickets/", "Current-edition official homepage links to Tickets");
    } else candidate.warnings.push("Roadburn homepage dates do not match a valid configured edition");
  }
  const names = new Map<string, string>();
  for (const document of documents) {
    const markup = clean(document.html);
    const canonical = [...markup.matchAll(/<link\b([^>]*)>/gi)].find(m => attr(m[1], "rel") === "canonical");
    if (roadburnUrl(attr(canonical?.[1] ?? "", "href") ?? "") !== document.url) { candidate.warnings.push("Roadburn announcement lacks matching official canonical URL"); continue; }
    const articles = [...markup.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
    if (articles.length !== 1) { candidate.warnings.push("Roadburn announcement article structure changed"); continue; }
    const article = articles[0][1], prose = text(article);
    const years = prose.match(/\b20\d{2}\b/g) ?? [];
    if (!new RegExp(`\\bRoadburn(?:\\s+in)?\\s+${source.editionYear}\\b`, "i").test(prose) || years.some(year => ![source.editionYear, source.editionYear - 1].includes(Number(year)))) continue;
    // Publication year may be previous-year; an explicit old festival edition
    // in the article still disqualifies it, even if the footer is current.
    if ([...prose.matchAll(/Roadburn(?:\s+in)?\s+(20\d{2})/gi)].some(m => Number(m[1]) !== source.editionYear)) continue;
    if (/\b(?:cancelled|canceled|cancellation|withdrawn|will not|no longer|replaced)\b/i.test(prose)) { candidate.warnings.push("Roadburn cancellation or replacement announcement requires review"); continue; }
    const acts = new Set<string>();
    const title = text(article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
    const titleName = title.match(/^(.+?)\s+(?:added to the line-up|returns? to Roadburn)/i)?.[1];
    const confirms = (name: string) => new RegExp(`\\b${escape(name)}\\s+will\\s+(?:bring|descend|perform|return|play|appear)\\b[^.!?]{0,300}?\\bRoadburn(?:\\s+in)?\\s+${source.editionYear}\\b`, "i").test(prose);
    if (titleName && nameValid(titleName) && confirms(titleName)) acts.add(titleName);
    for (const p of article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const paragraph = text(p[1]);
      for (const m of paragraph.matchAll(/(?:^|[.!?:]\s+)([\p{L}\d][\p{L}\d .’'&$+\-]{0,99}?)\s+will\s+(?:bring|descend|perform|return|play|appear)\b/gu)) {
        if (nameValid(m[1]) && confirms(m[1])) acts.add(m[1]);
      }
    }
    // Explicit joining-the-lineup list: linked bold names, not album titles,
    // collaborators in running prose, artwork credits or sidebar links.
    const list = article.match(/<p\b[^>]*>\s*Joining the line-up[^<]*<\/p>\s*<ul\b[^>]*>([\s\S]*?)<\/ul>/i)?.[1];
    // WordPress editors use both <a><strong> and <strong><a> nesting.
    const normalizedList = list?.replace(/<strong\b[^>]*>\s*(<a\b[^>]*>)([\s\S]*?)<\/a>\s*<\/strong>/gi, "$1<strong>$2</strong></a>");
    if (normalizedList) for (const a of normalizedList.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      let url: URL; try { url = new URL(attr(a[1], "href") ?? "", origin); } catch { continue; }
      if (url.origin !== origin || !/^\/band\/[a-z0-9-]+\/$/.test(url.pathname) || url.search || url.hash) continue;
      const name = text(a[2].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? "");
      if (nameValid(name)) acts.add(name);
    }
    for (const name of acts) names.set(name.toLowerCase(), name);
    if (acts.size) candidate.evidence.push({ field: "lineup", sourceUrl: document.url, observedAt: fetchedAt, excerpt: `${title}; ${[...acts].join(", ")}; Roadburn ${source.editionYear}`.slice(0, 500) });
    else candidate.warnings.push("Current Roadburn announcement exposes no supported artist assertion");
  }
  if (names.size) {
    candidate.lineup = [...names.values()]; candidate.lineupScope = "announcement"; candidate.status = "partial";
    if (!candidate.observedEditionYears.includes(source.editionYear)) candidate.observedEditionYears.push(source.editionYear);
    candidate.evidence.push({ field: "status", sourceUrl: candidate.evidence.find(e => e.field === "lineup")!.sourceUrl, observedAt: fetchedAt, excerpt: "Individual current-edition announcements are additions, not a complete replacement bill" });
    candidate.warnings.push(ROADBURN_ARTIST_REVIEW);
  }
  // Homepage and old news say 'on sale', but the actual landing page is stale
  // and links to /offsale. Do not convert these into available or sold_out.
  const ticketText = text(clean(tickets));
  if (new RegExp(`\\bRoadburn\\s+${source.editionYear}\\b`, "i").test(ticketText) && !/\boffsale\b/i.test(tickets) && /\b(?:4-day|four-day) tickets?\s+(?:are )?(?:on sale|available now)\b/i.test(ticketText)) {
    const buy = [...clean(tickets).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some(a => {
      try { const u = new URL(attr(a[1], "href") ?? ""); return u.origin === "https://tickets.roadburn.com" && !u.username && !u.password && /buy tickets?/i.test(text(a[2])); } catch { return false; }
    });
    if (buy) add("ticketStatus", "available", "Current-edition four-day tickets available with live official purchase link", origin + "/tickets/");
  }
  if (!candidate.evidence.length && !candidate.warnings.length) candidate.warnings.push("Roadburn page exposes no supported current-edition fields");
  return candidate;
}
