import type { FestivalCandidate, FestivalSource } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

const months = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#8211;|&ndash;/g, "–").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Current ticket summary only: Blind Bird sell-outs and sponsor shops are not the festival sale. */
export function extractSwedenRockCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug,
    sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const visible = html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1>/gi, " ");
  const heading = /<h([12])\b[^>]*>\s*Biljetter\s+(20\d{2})\s*<\/h\1>/i.exec(visible);
  if (!heading) {
    candidate.warnings.push("Sweden Rock current ticket summary was not found");
    return candidate;
  }
  const year = Number(heading[2]);
  candidate.observedEditionYears = [year];
  if (year !== source.editionYear) {
    candidate.warnings.push(`Sweden Rock ticket edition ${year} does not match source edition ${source.editionYear}`);
    return candidate;
  }
  // Stop at the next section heading: news, parking and merch must not decide availability.
  const tail = visible.slice(heading.index + heading[0].length);
  const end = tail.search(/<h[1-6]\b/i);
  const summary = tail.slice(0, end < 0 ? undefined : end);
  const text = plain(summary);
  const add = (field: "ticketsUrl" | "ticketStatus", value: string, excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) });
  };
  // Only the official information page. Never use an arbitrary shop or a generic buy button.
  const base = new URL(source.url);
  const official = [...visible.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[^]*?<\/a>/gi)]
    .find(match => {
      try {
        const url = new URL(match[1], base);
        return url.protocol === "https:" && url.origin === base.origin && /^\/biljetter\/?$/.test(url.pathname) && !url.search && !url.hash;
      } catch { return false; }
    });
  if (official) add("ticketsUrl", new URL(official[1], base).href.replace(/\/$/, ""), official[0]);
  else if (/^\/biljetter\/?$/.test(base.pathname)) add("ticketsUrl", base.href.replace(/\/$/, ""), heading[0]);

  const sale = /Ordinar(?:ie|e)\s+biljettsläpp:\s*(\d{1,2})\s+(\p{L}+)(?:\s+(20\d{2}))?\s+kl\.\s*(\d{1,2})[.:](\d{2})\s+(?:CEST|CET)/iu.exec(text);
  if (sale) {
    const month = months.indexOf(sale[2].toLowerCase()) + 1;
    const now = new Date(fetchedAt);
    if (month && !Number.isNaN(now.valueOf())) {
      const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
      const saleYear = sale[3] ?? local.slice(0, 4);
      const day = Number(sale[1]), hour = Number(sale[4]), minute = Number(sale[5]);
      const stamp = `${saleYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const validDay = day >= 1 && day <= new Date(Date.UTC(Number(saleYear), month, 0)).getUTCDate();
      if (validDay && hour < 24 && minute < 60 && (sale[3] || Number(local.slice(0, 4)) < year) && local < stamp) add("ticketStatus", "unavailable", `${heading[0]} ${text}`);
      // A scheduled date passing is not proof that tickets actually went on sale.
    }
  }
  const currentSale = text.replace(/Blind Bird\s+Round\s+\d[^.]*\./gi, " ");
  if (!candidate.ticketStatus && /(?:ordinarie\s+biljetter|festivalpass|4-dagarsbiljetter)\s+(?:är\s+)?(?:slutsålda|slutsålt)/iu.test(currentSale))
    add("ticketStatus", "sold_out", `${heading[0]} ${currentSale}`);
  if (!candidate.ticketStatus && /(?:ordinarie\s+biljetter|festivalpass|4-dagarsbiljetter)\s+(?:är\s+)?(?:nu\s+)?(?:till\s+salu|finns\s+att\s+köpa)/iu.test(currentSale))
    add("ticketStatus", "available", `${heading[0]} ${currentSale}`);
  if (!candidate.ticketStatus) candidate.warnings.push("Sweden Rock current festival ticket availability requires review");
  return candidate;
}
