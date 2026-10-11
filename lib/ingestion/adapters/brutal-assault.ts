import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";
import type { FetchAttempt } from "../fetch.ts";

const origin = "https://brutalassault.cz";
const bundleKind = "festival-radar:brutal-assault-documents:v1";
type Document = { url: string; html: string };
const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((v) => v !== undefined);
function officialUrl(value: string, base = origin): URL | undefined {
  try { const u = new URL(value, base); return u.origin === origin && !u.username && !u.password && !u.search && !u.hash ? u : undefined; } catch { return undefined; }
}
export function handlesBrutalAssault(source: FestivalSource): boolean {
  const u = officialUrl(source.url);
  return source.festivalSlug === "brutal-assault" && !!u && /^\/(?:en\/?|cs\/?)?$/.test(u.pathname) && source.strategies.includes("html_fallback") && (!source.fetchUrl || source.fetchUrl === source.url) && !source.followLinkPattern;
}
function links(html: string, base: string) {
  return [...visible(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap((m) => {
    const url = officialUrl(attr(m[1], "href") ?? "", base);
    return url ? [{ url, name: text(m[2]), tag: m[1] }] : [];
  });
}
// Fresh visible pages replace the commented-out homepage bill. Discover the
// current general pass by its product title, not by a pinned ticket ID/deadline.
export async function fetchBrutalAssaultDocuments(source: FestivalSource, initial: FetchAttempt, get: (url: string) => Promise<FetchAttempt>): Promise<FetchAttempt> {
  let attempts = initial.attempts;
  const read = async (url: string): Promise<Document> => {
    const r = await get(url); attempts += r.attempts;
    if (!r.response.ok) throw Object.assign(new Error(`Official Brutal Assault document HTTP ${r.response.status}`), { httpStatus: r.response.status, attempts });
    const final = officialUrl(r.response.url || url);
    if (!final || final.pathname !== new URL(url).pathname) throw new Error("Unexpected Brutal Assault document redirect");
    return { url: final.href, html: await r.response.text() };
  };
  const home = await initial.response.text();
  for (const path of ["line-up", "tickets"]) {
    if (!links(home, source.url).some(({ url }) => new RegExp(`^/(?:cs|en)/${path}/?$`).test(url.pathname))) throw new Error(`Official Brutal Assault ${path} link absent`);
  }
  // The linked Czech/English routes share the same current bill and products;
  // collect the English versions for an unambiguous festival-pass date label.
  const lineup = await read(`${origin}/en/line-up`);
  const tickets = await read(`${origin}/en/tickets`);
  const passes = links(tickets.html, tickets.url).filter(({ url, name, tag }) => /^\/en\/tickets\/detail\/id\/\d+$/.test(url.pathname) && /\bproduct_title\b/.test(attr(tag, "class") ?? "") && new RegExp(`\\bBRUTAL ASSAULT ${source.editionYear} festival pass\\b`, "i").test(name) && !/voucher|kids|juniors|disabled|VIP|parking|motel/i.test(name));
  const urls = [...new Set(passes.map(({ url }) => url.href))];
  if (urls.length !== 1) throw new Error("Current general Brutal Assault festival pass is absent or ambiguous");
  const pass = await read(urls[0]);
  return { attempts, response: new Response(JSON.stringify({ kind: bundleKind, lineup, pass }), { status: 200, headers: { "content-type": "application/json" } }) };
}

export function extractBrutalAssaultCandidate(payload: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!handlesBrutalAssault(source)) return undefined;
  const c: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const reject = (reason: string) => { c.warnings.push(reason); return c; };
  let bundle: { kind: string; lineup: Document; pass: Document };
  try { bundle = JSON.parse(payload); } catch { return reject("Brutal Assault requires fresh linked lineup and festival-pass documents; homepage archive is not a bill"); }
  if (!bundle || bundle.kind !== bundleKind || typeof bundle.lineup?.html !== "string" || typeof bundle.pass?.html !== "string" || officialUrl(bundle.lineup.url)?.href !== bundle.lineup.url || officialUrl(bundle.pass.url)?.href !== bundle.pass.url || officialUrl(bundle.lineup.url)?.pathname !== "/en/line-up" || !/^\/en\/tickets\/detail\/id\/\d+$/.test(officialUrl(bundle.pass.url)?.pathname ?? "")) return reject("Invalid official Brutal Assault document bundle");
  const bill = visible(bundle.lineup.html), pass = visible(bundle.pass.html);
  for (const heading of bill.matchAll(/<(?:h[12]|title)\b[^>]*>([\s\S]*?)<\/(?:h[12]|title)>/gi)) {
    const label = text(heading[1]);
    if (/line[ -]?up|bands|Brutal Assault/i.test(label)) for (const year of label.matchAll(/\b20\d{2}\b/g)) c.observedEditionYears.push(Number(year[0]));
  }
  c.observedEditionYears = [...new Set(c.observedEditionYears)];
  if (c.observedEditionYears.some((year) => year !== source.editionYear)) return reject("Brutal Assault lineup belongs to a different edition");
  const title = text(pass.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const year = title.match(/\bBRUTAL ASSAULT (20\d{2}) festival pass\b/i)?.[1];
  if (year && !c.observedEditionYears.includes(Number(year))) c.observedEditionYears.push(Number(year));
  if (Number(year) !== source.editionYear || /voucher|kids|juniors|VIP|parking|motel/i.test(title)) return reject("Brutal Assault pass is not the current general festival edition");
  const date = text(pass.match(/<div\b[^>]*id=["']product_description["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").match(/Festival ticket ([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2}),\s*(20\d{2})\b/i);
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const month = date && months[date[1].slice(0, 3).toLowerCase()];
  if (!date || !month || Number(date[4]) !== source.editionYear) return reject("Brutal Assault current pass dates could not be verified");
  const start = `${date[4]}-${month}-${date[2].padStart(2, "0")}`, end = `${date[4]}-${month}-${date[3].padStart(2, "0")}`;
  if (start > end || [start, end].some((d) => !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)) return reject("Invalid Brutal Assault festival date range");
  const add = (field: FieldEvidence["field"], value: string | string[], doc: Document, excerpt: string) => { Object.assign(c, { [field]: value }); c.evidence.push({ field, sourceUrl: doc.url, observedAt: fetchedAt, excerpt: excerpt.slice(0, 500) }); };
  add("startDate", start, bundle.pass, date[0]); add("endDate", end, bundle.pass, date[0]);
  add("ticketsUrl", `${origin}/en/tickets`, bundle.pass, title);
  const form = pass.match(/<form\b([^>]*\bid=["']add-to-cart["'][^>]*)>([\s\S]*?)<\/form>/i);
  const action = form && officialUrl(attr(form[1], "action") ?? "");
  const productId = new URL(bundle.pass.url).pathname.split("/").at(-1);
  const enabledPurchase = form && action?.pathname === `/en/tickets/cart/add/${productId}` && [...form[2].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].some((b) => !/\bdisabled\b/i.test(b[1]) && /\bAdd to cart\b/i.test(text(b[2])));
  if (enabledPurchase) add("ticketStatus", "available", bundle.pass, form![0]);
  else if (/\b(?:sold out|unavailable)\b/i.test(text(pass.match(/<div\b[^>]*class=["'][^"']*product_availability[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""))) add("ticketStatus", "unavailable", bundle.pass, title);
  const percent = bill.match(/<h1\b[^>]*>\s*(\d{1,3})%\s+CONFIRMED!\s*<\/h1>/i);
  if (!percent || Number(percent[1]) > 100) return reject("Brutal Assault current bill completeness is absent or invalid");
  const names = [...bill.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap((m) => {
    const u = officialUrl(attr(m[1], "href") ?? "");
    if (!u || !/^\/en\/band\/[^/]+$/.test(u.pathname) || !/\blineup_band_link\b/.test(attr(m[1], "class") ?? "")) return [];
    const name = text(m[2].match(/<strong\b[^>]*class=["'][^"']*\bband_lineup_title\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? "");
    return name ? [name] : [];
  });
  const unique = [...new Map(names.map((n) => [n.toLocaleLowerCase(), n])).values()];
  if (!unique.length) return reject("Brutal Assault live artist cards are absent; do not erase verified lineup");
  add("lineup", unique, bundle.lineup, unique.join(", "));
  add("status", Number(percent[1]) === 100 ? "confirmed" : "partial", bundle.lineup, percent[0]);
  // Alphabetical cards, guest labels and announcement leads are not headliners.
  return c;
}
