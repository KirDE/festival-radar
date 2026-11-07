import type { FestivalCandidate, FestivalSource } from "../types.ts";

const months: Record<string, number> = {
  enero: 1, gener: 1, january: 1, febrero: 2, febrer: 2, february: 2,
  marzo: 3, març: 3, march: 3, abril: 4, april: 4, mayo: 5, maig: 5, may: 5,
  junio: 6, juny: 6, june: 6, julio: 7, juliol: 7, july: 7,
  agosto: 8, agost: 8, august: 8, septiembre: 9, setembre: 9, september: 9,
  octubre: 10, october: 10, noviembre: 11, novembre: 11, november: 11,
  diciembre: 12, desembre: 12, december: 12,
};

// The current homepage has explicit date/sales headings, not Event JSON-LD.
// Do not infer duration from the evergreen FAQ or dates from last year's images.
export function applyBarcelonaBanner(html: string, source: FestivalSource, candidate: FestivalCandidate): void {
  if (source.festivalSlug !== "barcelona-rock-fest" || new URL(source.url).hostname !== "www.barcelonarockfest.com") return;
  const headings = [...html.matchAll(/<h2\b[^>]*class=["'][^"']*\bpar-([23])\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(match => ({ role: match[1], text: match[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim(), excerpt: match[0].slice(0, 500) }));
  const dates = headings.filter(h => h.role === "2");
  if (dates.length !== 1) return; // Conflicting banners need review, not a guess.
  const match = dates[0].text.match(/^(\d{1,2}(?:\s*[-–,]\s*\d{1,2})*)\s+([\p{L}]+)\s+(20\d{2})$/u);
  if (!match) return;
  const month = months[match[2].toLowerCase()], year = Number(match[3]);
  const days = match[1].split(/\s*[-–,]\s*/).map(Number);
  if (!month || days.some((day, i) => day < 1 || day > 31 || (i > 0 && day !== days[i - 1] + 1))) return;
  const iso = (day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (days.some(day => new Date(`${iso(day)}T00:00:00Z`).toISOString().slice(0, 10) !== iso(day))) return;
  candidate.observedEditionYears.push(year);
  if (year !== source.editionYear) return;
  const add = (field: "startDate" | "endDate" | "ticketStatus", value: string, excerpt: string) => {
    Object.assign(candidate, { [field]: value });
    candidate.evidence = candidate.evidence.filter(e => e.field !== field);
    candidate.evidence.push({ field, sourceUrl: source.url, observedAt: candidate.fetchedAt, excerpt });
  };
  // The official purchase route is localized; keep the reviewed English route
  // when the Spanish homepage links the same /tickets landing page.
  if (candidate.ticketsUrl === new URL("/tickets", source.url).href) {
    candidate.ticketsUrl = new URL("/en/tickets", source.url).href;
  }
  add("startDate", iso(days[0]), dates[0].excerpt);
  add("endDate", iso(days.at(-1)!), dates[0].excerpt);
  // Visible dated announcement headings are independent of the stale image
  // poster and hidden multilingual Nuxt payload. Never infer headline billing.
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const names: string[] = [];
  for (const heading of visible.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const text = heading[1].replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
    const announcement = text.match(/^(.{1,100}?),\s*(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), July (\d{1,2})(?:st|nd|rd|th)? at|(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo) (\d{1,2}) de julio en|(?:dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge) (\d{1,2}) de juliol al) Barcelona Rock Fest (20\d{2})$/iu);
    if (!announcement || Number(announcement[5]) !== year || month !== 7) continue;
    const day = Number(announcement[2] ?? announcement[3] ?? announcement[4]);
    if (!days.includes(day)) continue;
    const name = announcement[1].trim();
    if (!name || /^(?:line up|tickets?|artists?)$/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
    candidate.evidence.push({ field: "lineup", sourceUrl: source.url, observedAt: candidate.fetchedAt, excerpt: heading[0].slice(0, 500) });
  }
  if (names.length) {
    candidate.lineup = [...new Set([...(candidate.lineup ?? []), ...names])];
    candidate.lineupScope = "announcement";
    candidate.artistListMode = "additive";
  }
  const sales = headings.filter(h => h.role === "3");
  if (sales.length === 1 && /^(?:tickets? ya a la venta|tickets? (?:are )?(?:now on sale|on sale(?: now)?)|entrades ja a la venda)$/i.test(sales[0].text)) {
    add("ticketStatus", "available", sales[0].excerpt);
  }
}
