import type { FestivalCandidate, FestivalSource } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();

// The current banner is edition-bound. Retrospective cards, image-only bills
// and stale ticket terms elsewhere on the page cannot establish artists,
// completeness or current stock. Read only dates and the official landing link.
export function extractAlcatrazCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const fail = (reason: string) => { candidate.warnings.push("Alcatraz current banner: " + reason); return candidate; };
  let page: URL;
  try { page = new URL(source.url); } catch { return fail("invalid source URL"); }
  if (page.origin !== "https://www.alcatraz.be" || page.search || page.hash ||
      !/^\/(?:[a-z]{2}\/(?:index|tickets)?\/?)?$/.test(page.pathname)) return fail("unsupported official page");
  const document = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const title = plain(document.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const titleYear = title.match(/\bAlcatraz Open Air\s+(20\d{2})\b/i)?.[1];
  const banners = [...document.matchAll(/<section\b[^>]*class=["'][^"']*\btop-banner\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi)];
  const dates = banners.flatMap(banner => [...banner[1].matchAll(/<span\b[^>]*class=["'][^"']*\bnavbar-text\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)])
    .map(match => plain(match[1])).filter(text => /\b20\d{2}\b/.test(text));
  if (!titleYear || dates.length !== 1) return fail("missing or ambiguous edition/date evidence");
  const date = dates[0].match(/^([a-z]+)\s+(\d{1,2}(?:\s*[.\/]\s*\d{1,2}){1,6})\s+(20\d{2})\s*\|\s*Kortrijk\s*[-–]\s*BE$/i);
  if (!date || date[3] !== titleYear) return fail("title and dated banner disagree");
  const year = Number(date[3]);
  candidate.observedEditionYears = [year];
  if (year !== source.editionYear) return fail("edition differs from configured source year");
  const month = months.indexOf(date[1].toLowerCase());
  const days = date[2].split(/[.\/]/).map(Number);
  if (month < 0 || days.some((day, index) => day < 1 || new Date(Date.UTC(year, month, day)).getUTCMonth() !== month ||
      (index > 0 && day !== days[index - 1] + 1))) return fail("invalid or nonconsecutive festival dates");
  candidate.startDate = new Date(Date.UTC(year, month, days[0])).toISOString().slice(0, 10);
  candidate.endDate = new Date(Date.UTC(year, month, days.at(-1)!)).toISOString().slice(0, 10);
  for (const field of ["startDate", "endDate"] as const)
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: title + "; " + dates[0] });
  const nav = document.match(/<nav\b[^>]*class=["'][^"']*\bnavbar-primary\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? "";
  for (const link of nav.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let target: URL;
    try { target = new URL(link[1], page); } catch { continue; }
    if (target.origin !== page.origin || target.search || target.hash || !/^\/(en|fr|nl)\/tickets\/?$/.test(target.pathname)) continue;
    candidate.ticketsUrl = target.href;
    candidate.evidence.push({ field: "ticketsUrl", sourceUrl: source.url, observedAt: fetchedAt, excerpt: dates[0] + "; " + link[0].slice(0, 300) });
    break;
  }
  return candidate;
}
