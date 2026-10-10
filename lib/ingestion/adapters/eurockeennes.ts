import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|#160);/gi, " ").replace(/&amp;/gi, "&").replace(/&#0?39;|&(?:apos|rsquo|lsquo);/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(value => value !== undefined);

/** The current homepage is the configured source. Never read its archive carousel,
 * hidden templates or old ticket banner as current edition evidence. */
export function extractEurockeennesCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const title = text(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const date = title.match(/Les Eurockéennes de Belfort\s*[–—-]\s*((?:\d{1,2}\s*(?:,|et)\s*)+\d{1,2})\s+([\p{L}]+)\s+(20\d{2})\b/u);
  const month = date ? months.indexOf(date[2].toLowerCase()) + 1 : 0;
  const days = date?.[1].match(/\d+/g)?.map(Number) ?? [];
  const year = Number(date?.[3]);
  const dates = days.map(day => new Date(Date.UTC(year, month - 1, day)));
  if (!date || !month || year !== source.editionYear || days.length < 2 || days.length > 7 || dates.some((d, i) => d.getUTCMonth() !== month - 1 || d.getUTCFullYear() !== year || (i > 0 && d.getTime() - dates[i - 1].getTime() !== 86400000))) {
    candidate.warnings.push("Eurockéennes current edition date anchor was not found");
    return candidate;
  }
  const add = (field: FieldEvidence["field"], value: unknown, excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  candidate.observedEditionYears = [year];
  add("startDate", dates[0].toISOString().slice(0, 10), title);
  add("endDate", dates.at(-1)!.toISOString().slice(0, 10), title);
  add("city", "Belfort", title);

  const links = [...clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const news = links.filter(link => (attr(link[1], "class") ?? "").split(/\s+/).includes(`categorie-eurocks-${year}`));
  const first = news.find(link => {
    const href = attr(link[1], "href");
    if (!href || !/Première annonce/i.test(text(link[2]))) return false;
    try { return new URL(href, source.url).origin === "https://www.eurockeennes.fr" && new URL(href, source.url).pathname === `/actualite/premier-artiste-${year}/`; } catch { return false; }
  });
  // A later programme announcement invalidates the first-wave billing snapshot.
  const laterProgramme = news.some(link => link !== first && !/premier-artiste/.test(attr(link[1], "href") ?? "") && /programmation|programme|line.?up|(?:nouvelle|deuxième|seconde|dernière) annonce/i.test(text(attr(link[1], "title") ?? link[2])));
  const closing = text(attr(first?.[1] ?? "", "title") ?? "").match(/^(.{1,100}?) clôture le festival (?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2}) ([\p{L}]+) (20\d{2})$/u);
  if (!laterProgramme && closing && Number(closing[4]) === year && Number(closing[2]) === days.at(-1) && months.indexOf(closing[3].toLowerCase()) + 1 === month && /Première annonce/i.test(text(first![2]))) {
    add("headliners", [closing[1]], first![0]);
    // Do not emit an empty lineup: existing verified partial acts must survive.
    add("status", "partial", first![0]);
  }
  for (const link of links) {
    const href = attr(link[1], "href");
    if (!href || !/billetterie/i.test(text(link[2]))) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), source.url);
      if (url.origin !== "https://www.eurockeennes.fr" || url.pathname !== "/achat/" || url.search || url.hash) continue;
      add("ticketsUrl", url.href, link[0]);
      break;
    } catch { continue; }
  }
  // A dated news headline isn't live stock. Only current purchase cards count;
  // "autres formules bientôt disponibles" must not make tickets available.
  const heading = text(clean.match(/<h1\b[^>]*class=["']entry-title["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  if (new RegExp(`^Eurocks ${year}\\s*:`).test(heading)) {
    const cards = links.filter(link => new RegExp(`\\blkbill${String(year).slice(-2)}\\b`).test(attr(link[1], "class") ?? "") && attr(link[1], "href") === "/achat/" && !/style\s*=\s*["'][^"']*display\s*:\s*none/i.test(link[1]));
    const available = cards.find(link => /\bDisponible\b/i.test(text(link[2])) && /\d+\s*€/.test(text(link[2])) && !/bientôt|prochainement|épuisé|indisponible/i.test(text(link[2])));
    if (available) add("ticketStatus", "available", available[0]);
    if (/première annonce/i.test(heading)) add("status", "partial", heading);
  }
  return candidate;
}
