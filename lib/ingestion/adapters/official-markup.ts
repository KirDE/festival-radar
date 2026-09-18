import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

type AdapterResult = { startDate?: string; endDate?: string; city?: string; headliners?: string[]; lineup?: string[]; excerpt: string };

const months: Record<string, string> = { januari: "01", februari: "02", maart: "03", april: "04", mei: "05", juni: "06", juli: "07", augustus: "08", september: "09", oktober: "10", november: "11", december: "12" };
const pad = (value: string) => value.padStart(2, "0");

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

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decode(match[1] ?? match[2] ?? "") : undefined;
}

function ringAndPark(html: string): AdapterResult | undefined {
  const date = html.match(/\b(\d{1,2})\s*\.?\s*(?:[-–—]|bis|to)\s*(\d{1,2})\s*\.?\s+(juni|june)\s+(20\d{2})\b/i);
  if (!date) return undefined;

  const headliners: string[] = [];
  const lineup: string[] = [];
  let excerpt = date[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, "https://festival.invalid/").pathname;
    } catch {
      continue;
    }
    if (!/(?:^|\/)line-up\/[^/]+\/?$/i.test(pathname)) continue;

    const text = decode(match[2].replace(/<[^>]+>/g, " "));
    const image = match[2].match(/<img\b[^>]*>/i)?.[0];
    const imageName = image ? attribute(image, "title") ?? attribute(image, "alt")?.replace(/^Logo\s+/i, "") : undefined;
    const name = (text || imageName || "").trim();
    if (!name) continue;

    const dayStart = html.lastIndexOf('<article class="lineup-day"', match.index);
    const context = html.slice(dayStart < 0 ? 0 : dayStart, match.index);
    const labels = [...context.matchAll(/\baria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)];
    const group = labels.at(-1)?.[1] ?? labels.at(-1)?.[2] ?? "";
    const target = /^headliner$/i.test(group) ? headliners : lineup;
    if (![...headliners, ...lineup].some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) target.push(name);
    if (excerpt === date[0]) excerpt = match[0].slice(0, 500);
  }
  if (headliners.length + lineup.length === 0) return undefined;
  return {
    startDate: `${date[4]}-06-${pad(date[1])}`,
    endDate: `${date[4]}-06-${pad(date[2])}`,
    headliners,
    lineup,
    excerpt,
  };
}

function fkpArtistName(value: string): string {
  if (value !== value.toLocaleUpperCase()) return value;
  const smallWords = new Set(["and", "de", "of", "the"]);
  return value.split(/\s+/).map((word, index) => {
    if (["I", "MGK", "VNV"].includes(word)) return word;
    return word.split("-").map((part) => {
      const lower = part.toLocaleLowerCase();
      return index > 0 && smallWords.has(lower) ? lower : part ? `${part[0].toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}` : part;
    }).join("-");
  }).join(" ");
}

function meraLuna(html: string): AdapterResult | undefined {
  const edition = html.match(/\bLine-Up\s+(20\d{2})\b/i);
  if (!edition) return undefined;
  const date = [...html.matchAll(/\b(\d{1,2})\s*\.\s*(?:&amp;|&|[-–—])\s*(\d{1,2})\s*\.\s+August\s+(20\d{2})\b/gi)]
    .find((candidate) => candidate[3] === edition[1]);
  if (!date) return undefined;

  const lineup: string[] = [];
  let excerpt = edition[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, "https://festival.invalid/").pathname;
    } catch {
      continue;
    }
    if (!/^\/line-up\/act\/[^/]+\/?$/i.test(pathname)) continue;

    const blockStart = html.lastIndexOf("<lineup-block", match.index);
    const blockEnd = html.lastIndexOf("</lineup-block>", match.index);
    if (blockStart < 0 || blockStart < blockEnd) continue;

    const name = fkpArtistName(decode(match[2].replace(/<[^>]+>/g, " ")));
    if (!name || lineup.some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) continue;
    lineup.push(name);
    if (excerpt === edition[0]) excerpt = `${edition[0]} ${match[0]}`;
  }
  if (lineup.length === 0) return undefined;
  return {
    startDate: `${date[3]}-08-${pad(date[1])}`,
    endDate: `${date[3]}-08-${pad(date[2])}`,
    lineup,
    excerpt,
  };
}

function fkpLineup(html: string): AdapterResult | undefined {
  const edition = html.match(/\bLine-Up\s+(20\d{2})\b/i);
  const date = html.match(/\b(\d{1,2})\s*\.\s*(?:[-–—]\s*)?(\d{1,2})\s*\.\s+Juni\s+(20\d{2})\b/i);
  if (!edition || !date || edition[1] !== date[3]) return undefined;

  const headliners: string[] = [];
  const lineup: string[] = [];
  let excerpt = edition[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, "https://festival.invalid/").pathname;
    } catch {
      continue;
    }
    if (!/^\/line-up\/act\/[^/]+\/?$/i.test(pathname)) continue;

    const blockStart = html.lastIndexOf("<lineup-block", match.index);
    const blockEnd = html.lastIndexOf("</lineup-block>", match.index);
    if (blockStart < 0 || blockStart < blockEnd) continue;
    const blockTagEnd = html.indexOf(">", blockStart);
    if (blockTagEnd < blockStart || blockTagEnd > match.index) continue;
    const blockTag = html.slice(blockStart, blockTagEnd + 1);

    const rawName = decode(match[2].replace(/<[^>]+>/g, " "));
    const name = fkpArtistName(rawName);
    if (!name || [...headliners, ...lineup].some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) continue;
    const target = /block--size-XXL\b/i.test(blockTag) ? headliners : lineup;
    target.push(name);
    if (excerpt === edition[0]) excerpt = `${edition[0]} ${match[0]}`;
  }
  if (headliners.length === 0 || lineup.length === 0) return undefined;
  return {
    startDate: `${date[3]}-06-${pad(date[1])}`,
    endDate: `${date[3]}-06-${pad(date[2])}`,
    headliners,
    lineup,
    excerpt,
  };
}

function pinkpop(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})\s*[•·]\s*(\d{1,2})\s*[•·]\s*(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/i);
  if (!date) return undefined;
  const location = html.match(/class=["'][^"']*location[^"']*["'][^>]*>[\s\S]{0,200}?<strong[^>]*>[^<]+<\/strong>\s*([^<]+)/i);
  return { startDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[1])}`, endDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[3])}`, city: location?.[1].trim(), excerpt: date[0] };
}

function tuska(html: string): AdapterResult | undefined {
  const date = html.match(/Tuska Festival\s*[-–—]\s*(\d{1,2})\.[–-](\d{1,2})\.(\d{1,2})\.(20\d{2})/i);
  if (!date) return undefined;
  return { startDate: `${date[4]}-${pad(date[3])}-${pad(date[1])}`, endDate: `${date[4]}-${pad(date[3])}-${pad(date[2])}`, excerpt: date[0] };
}

function trees(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})(?:st|nd|rd|th)\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if (!date) return undefined;
  const month = String(new Date(`${date[3]} 1, 2000`).getUTCMonth() + 1).padStart(2, "0");
  return { startDate: `${date[4]}-${month}-${pad(date[1])}`, endDate: `${date[4]}-${month}-${pad(date[2])}`, excerpt: date[0] };
}

function tolminator(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})\s+July\s*[-–—]\s*(\d{1,2})\s+August\s+(20\d{2})/i);
  if (!date) return undefined;
  return { startDate: `${date[3]}-07-${pad(date[1])}`, endDate: `${date[3]}-08-${pad(date[2])}`, excerpt: date[0] };
}

function leyendas(html: string): AdapterResult | undefined {
  const title = html.match(/<title[^>]*>[\s\S]*?Leyendas del Rock\s+(20\d{2})[\s\S]*?<\/title>/i);
  return title ? { excerpt: title[0].replace(/<[^>]+>/g, " ").trim() } : undefined;
}

const adapters: Record<string, (html: string) => AdapterResult | undefined> = {
  "2000trees": trees,
  "hurricane": fkpLineup,
  "mera-luna": meraLuna,
  "pinkpop": pinkpop,
  "rock-am-ring": ringAndPark,
  "rock-im-park": ringAndPark,
  "southside": fkpLineup,
  "tuska": tuska,
  "tolminator": tolminator,
  "leyendas-del-rock": leyendas,
};

export function extractOfficialMarkupCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const result = adapters[source.festivalSlug]?.(html);
  if (!result) {
    candidate.warnings.push(`Official markup adapter found no trustworthy fields for ${source.festivalSlug}`);
    return candidate;
  }
  if (result.startDate) candidate.observedEditionYears.push(Number(result.startDate.slice(0, 4)));
  for (const field of ["startDate", "endDate", "city", "headliners", "lineup"] as const) {
    const value = result[field];
    if (!value || (Array.isArray(value) && value.length === 0)) continue;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field: field as FieldEvidence["field"], sourceUrl: source.url, observedAt: fetchedAt, excerpt: result.excerpt.slice(0, 500) });
  }
  if (!candidate.evidence.length) candidate.warnings.push("Official title confirms the current edition but exposes no supported structured field");
  return candidate;
}
