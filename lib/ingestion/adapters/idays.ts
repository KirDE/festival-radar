import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

export const IDAYS_ARTIST_REVIEW = "Agent review required before I-Days lineup-triggered provider activity";
const decode = (value: string) => value.replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
const text = (value: string) => decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? "");
const validName = (value: string) => value.length > 0 && value.length <= 100 && /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,:!+?()/\-]*$/u.test(value) && !/\b(?:and more|biglietti|tickets|headliners|special guests|20\d{2})\b/i.test(value);

// The reviewed homepage hierarchy corresponds to the official /line-up
// HEADLINERS and SPECIAL GUESTS groups. Never extract navigation/biography
// prose, infer continuous dates from isolated concerts, or call a ticket CTA
// proof of availability. Supports future artists/years, not a frozen bill.
export function extractIdaysCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [], artistListMode: "additive" };
  const fail = (reason: string) => { candidate.warnings.push(`I-Days review required: ${reason}`); return candidate; };
  let url: URL;
  try { url = new URL(source.url); } catch { return fail("invalid source URL"); }
  if (source.festivalSlug !== "idays" || url.origin !== "https://www.idays.it" || !["/", "/line-up", "/tickets"].includes(url.pathname) || url.search || url.hash) return fail("unrecognized official source");
  const visible = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const sections = [...visible.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)].map(m => m[0]);
  const add = (field: FieldEvidence["field"], value: string | string[], excerpt: string) => { Object.assign(candidate, { [field]: value }); candidate.evidence.push({ field, sourceUrl: source.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 1800) }); };
  if (url.pathname === "/tickets") {
    // Require festival-day admission wording and current-edition, live
    // purchase links. A disability-area exhaustion is not general sell-out.
    if (!/l'acquisto del biglietto garantisce l'accesso al festival per l'intera giornata/i.test(text(visible))) return fail("no festival admission evidence");
    const purchases = [...visible.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].filter(m => {
      if (text(m[0]) !== "Acquista" || /aria-disabled=["']true|\bdisabled\b/i.test(m[0])) return false;
      try { const target = new URL(attr(m[0], "href")); return target.protocol === "https:" && ["www.ticketmaster.it", "www.vivaticket.com"].includes(target.hostname) && new RegExp(`(?:^|[^0-9])${source.editionYear}(?:[^0-9]|$)`).test(target.pathname) && !/merch|parking|vip|offsale/i.test(target.pathname); } catch { return false; }
    });
    if (!purchases.length) return fail("no current-edition general-admission purchase link");
    add("ticketsUrl", "https://www.idays.it/tickets", purchases[0][0]);
    add("ticketStatus", "available", purchases[0][0]);
    candidate.observedEditionYears = [source.editionYear];
    return candidate;
  }
  const heading = sections.findIndex(s => /Scopri i protagonisti dell'edizione\s+(20\d{2})/i.test(text(s)));
  if (heading < 0) return fail("missing edition heading");
  const year = Number(text(sections[heading]).match(/Scopri i protagonisti dell'edizione\s+(20\d{2})/i)?.[1]);
  if (year !== source.editionYear) return fail(`official edition ${year} differs from configured edition`);
  const headliners: string[] = [], lineup: string[] = [], excerpts: string[] = [];
  const record = (target: string[], value: string) => {
    if (!validName(value)) throw new Error("unrecognized artist label");
    if (!target.some(n => n.toLowerCase() === value.toLowerCase())) target.push(value);
  };
  const cards = (section: string, primary: string[]) => {
    let count = 0;
    for (const m of section.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      if (!/\bMuiCardActionArea-root\b/.test(attr(m[0], "class"))) continue;
      const target = new URL(attr(m[0], "href"), source.url);
      if (target.origin !== url.origin || target.pathname !== "/tickets" || (url.pathname === "/" && !target.hash)) throw new Error("unexpected concert link");
      const names = [...m[0].matchAll(/<p\b[^>]*class=["'][^"']*\bMuiTypography-header3\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)];
      if (names.length !== 1) throw new Error("changed concert card");
      record(primary, text(names[0][1]));
      const support = text(m[0].match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? "");
      const known = support.replace(/(?:,\s*)?and more\.{0,3}$/i, "").trim();
      if (known && url.pathname === "/") for (const name of known.split(/\s*,\s*/)) record(lineup, name);
      excerpts.push(text(m[0])); count++;
    }
    return count;
  };
  try {
    if (url.pathname === "/") {
      if (!sections[heading + 1] || !cards(sections[heading + 1], headliners)) return fail("missing current concert cards");
    } else {
      // Billing is explicit even when the section headings are image-only.
      if (!/\/headliners[^/]*\.(?:png|webp)/i.test(sections[heading])) return fail("missing explicit headliner group");
      let supporting = false;
      for (const section of sections.slice(heading + 1)) {
        if (/\/special-guests[^/]*\.(?:png|webp)/i.test(section)) { supporting = true; continue; }
        const title = section.match(/<h2\b[^>]*data-variant=["']header3["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
        const image = title?.match(/<img\b[^>]*>/i)?.[0];
        if (image) {
          const name = attr(image, "alt").replace(/\.(?:png|webp)(?:\s*\(\d+\))?$/i, "").replace(/_$/, "");
          const id = attr(section.match(/<section\b[^>]*>/i)?.[0] ?? "", "id");
          const navigation = [...visible.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].find(m => id && attr(m[0], "href") === `#${id}`);
          const label = navigation ? text(navigation[0]) : name;
          // Logo filenames lose punctuation; the matching section navigation
          // supplies the exact display spelling, not a hardcoded identity.
          const identity = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
          record(supporting ? lineup : headliners, identity(label) === identity(name) ? label : name); excerpts.push(title!);
        } else if (supporting) cards(section, lineup);
      }
      if (!headliners.length) return fail("missing headliner artists");
    }
  } catch { return fail("artist/card structure changed"); }
  if (/\b(?:cancelled|canceled|annullat[oa]|cancellat[oa])\b/i.test(excerpts.join(" "))) return fail("cancellation announcement");
  add("headliners", headliners, excerpts.join("; "));
  if (lineup.length) add("lineup", lineup.filter(n => !headliners.some(h => h.toLowerCase() === n.toLowerCase())), excerpts.join("; "));
  if (/and more\.{0,3}/i.test(excerpts.join(" "))) add("status", "partial", excerpts.join("; "));
  if (/<a\b[^>]*href=["']\/tickets(?:#[^"']*)?["']/i.test(visible)) add("ticketsUrl", "https://www.idays.it/tickets", "Official current edition concert ticket links");
  candidate.observedEditionYears = [year];
  candidate.warnings.push(IDAYS_ARTIST_REVIEW);
  return candidate;
}
