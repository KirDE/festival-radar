import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

type SupportedField = FieldEvidence["field"];

function decode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result.set(match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return result;
}

function plainDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

function metaContent(html: string, names: string[]): { value: string; excerpt: string } | undefined {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (expected.has(key) && content) return { value: content, excerpt: match[0].slice(0, 500) };
  }
  return undefined;
}

function timeValue(html: string, role: "start" | "end"): { value: string; excerpt: string } | undefined {
  for (const match of html.matchAll(/<time\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const marker = `${attrs.get("itemprop") ?? ""} ${attrs.get("class") ?? ""} ${attrs.get("data-role") ?? ""}`.toLowerCase();
    if (!marker.includes(role)) continue;
    const value = attrs.get("datetime");
    if (value) return { value, excerpt: match[0].slice(0, 500) };
  }
  return undefined;
}

function ticketLink(html: string, sourceUrl: string): { value: string; excerpt: string } | undefined {
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const tagAndText = decode(`${match[0].slice(0, match[0].indexOf(">") + 1)} ${match[3].replace(/<[^>]+>/g, " ")}`).toLowerCase();
    if (!/\b(ticket|tickets|buy|shop|karten|billet|entradas)\b/.test(tagAndText)) continue;
    try {
      const url = new URL(decode(match[1] ?? match[2]), sourceUrl);
      if (url.protocol === "https:") return { value: url.href, excerpt: match[0].slice(0, 500) };
    } catch {
      continue;
    }
  }
  return undefined;
}

function markedNames(html: string): { values: string[]; excerpt: string } | undefined {
  const values: string[] = [];
  let excerpt = "";
  const pattern = /<([a-z][\w:-]*)\b([^>]*(?:data-artist|itemprop\s*=\s*["']performer["']|class\s*=\s*["'][^"']*(?:artist|lineup)[^"']*["'])[^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = attributes(`<${match[1]} ${match[2]}>`);
    const value = decode(attrs.get("data-artist") ?? match[3].replace(/<[^>]+>/g, " "));
    if (value && value.length <= 120 && !/^(line-?up|artists?|performers?)$/i.test(value)) {
      values.push(value);
      if (!excerpt) excerpt = match[0].slice(0, 500);
    }
  }
  const byNormalizedName = new Map<string, string>();
  for (const value of values) {
    const normalized = value.toLocaleLowerCase();
    if (!byNormalizedName.has(normalized)) byNormalizedName.set(normalized, value);
  }
  const unique = [...byNormalizedName.values()];
  return unique.length ? { values: unique, excerpt } : undefined;
}

export function extractHtmlFallbackCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
  };
  const start = metaContent(html, ["event:start_time", "event:start_date", "festival:start_date"]) ?? timeValue(html, "start");
  const end = metaContent(html, ["event:end_time", "event:end_date", "festival:end_date"]) ?? timeValue(html, "end");
  const city = metaContent(html, ["event:location", "festival:city", "geo.placename"]);
  const tickets = ticketLink(html, source.url);
  const lineup = markedNames(html);

  const add = (field: SupportedField, value: string | string[] | undefined, excerpt: string | undefined) => {
    if (value === undefined) return;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt });
  };
  add("startDate", plainDate(start?.value), start?.excerpt);
  add("endDate", plainDate(end?.value), end?.excerpt);
  add("city", city?.value, city?.excerpt);
  add("ticketsUrl", tickets?.value, tickets?.excerpt);
  add("lineup", lineup?.values, lineup?.excerpt);

  if (candidate.evidence.length === 0) candidate.warnings.push("HTML fallback did not find explicitly marked festival fields");
  return candidate;
}
