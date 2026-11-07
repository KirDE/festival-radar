import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { FestivalSource, FestivalCandidate, FieldEvidence } from "../types.ts";

export const ROSKILDE_HOME = "https://www.roskilde-festival.dk/";
export const ROSKILDE_REVIEW = "New unranked Roskilde programme additions require artist review";
const origin = "https://www.roskilde-festival.dk";
export const isRoskildeSource = (s: FestivalSource) => s.festivalSlug === "roskilde" && s.url === ROSKILDE_HOME &&
  !s.fetchUrl && s.strategies.includes("html_fallback") && s.editionYear >= 2027;

export async function fetchRoskildeDocuments(year: number) {
  if (!Number.isInteger(year) || year < 2027 || year > 2100) throw Error("Invalid Roskilde year");
  const { stdout } = await promisify(execFile)("/usr/bin/python3", [fileURLToPath(new URL("./roskilde-fetch.py", import.meta.url)), String(year)],
    { timeout: 85_000, maxBuffer: 12 * 1024 * 1024, encoding: "utf8" });
  const envelope = JSON.parse(stdout);
  if (envelope.kind === "roskilde-fetch-error") {
    const status = Number.isInteger(envelope.status) && envelope.status >= 400 && envelope.status <= 599 ? envelope.status : 502;
    return { response: new Response(null, {status}), attempts: 1 };
  }
  return { response: new Response(stdout, { headers: { "content-type": "application/json" } }), attempts: 1 };
}

const plain = (s: string) => s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#(?:39|x27);|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
type Document = { url: string; html: string };
const cards = (html: string) => [...html.matchAll(/<a\b[^>]*href=["']\/program\/musik\/([a-z0-9-]+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .flatMap(m => { const title = m[2].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i); return title ? [{ slug: m[1], name: plain(title[1]) }] : []; });

export function extractRoskildeCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isRoskildeSource(source)) return;
  const c: FestivalCandidate = { schemaVersion: 1, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  let docs: Document[];
  try {
    const data = JSON.parse(html);
    if (data.kind !== "roskilde-documents-v1" || !Array.isArray(data.documents) || data.documents.length > 5) throw Error();
    docs = data.documents;
    if (docs.some(d => typeof d.html !== "string" || typeof d.url !== "string" || !new RegExp("^https://www\\.roskilde-festival\\.dk/(?:program|nyheder/[a-z0-9-]+)?$").test(d.url))) throw Error();
    if (new Set(docs.map(d => d.url)).size !== docs.length) throw Error();
  } catch { c.warnings.push("Invalid Roskilde official document envelope"); return c; }
  const home = docs.find(d => d.url === source.url), programme = docs.find(d => d.url === origin + "/program");
  const date = home && plain(home.html).match(/\b(\d{1,2})\/(\d{1,2})\s*[–—-]\s*(\d{1,2})\/(\d{1,2})\s+(20\d{2})\b/);
  if (!home || !programme || !date || Number(date[5]) !== source.editionYear || !plain(programme.html).includes(date[0])) { c.warnings.push("Roskilde current edition/dates not verified"); return c; }
  const iso = (day: string, month: string) => `${date[5]}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
  const start = iso(date[1], date[2]), end = iso(date[3], date[4]);
  if (![start,end].every(d => Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d) || end < start || Date.parse(end)-Date.parse(start) > 14*86400000) {
    c.warnings.push("Invalid Roskilde festival date range"); return c;
  }
  const evidence = (field: FieldEvidence["field"], d: Document, excerpt: string) => c.evidence.push({ field, sourceUrl: d.url, observedAt: fetchedAt, excerpt: excerpt.slice(0,500) });
  c.startDate=start; c.endDate=end; c.observedEditionYears=[source.editionYear]; evidence("startDate",home,date[0]);evidence("endDate",home,date[0]);
  const roster=cards(programme.html);
  const articles=docs.filter(d => d.url.startsWith(origin+"/nyheder/") && home.html.includes(`href="${d.url.slice(origin.length)}"`) &&
    new RegExp(`\\bRF${String(source.editionYear).slice(-2)}\\b`).test(plain(d.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")));
  const announced=new Set(articles.flatMap(d => [...d.html.matchAll(/href=["']\/program\/musik\/([a-z0-9-]+)["']/gi)].map(m=>m[1])));
  if (!roster.length || roster.some(r=>!r.name || r.name.length>100 || !announced.has(r.slug)) || new Set(roster.map(r=>r.slug)).size!==roster.length) {
    c.warnings.push("Roskilde programme cards need matching current-edition official announcements");return c;
  }
  c.lineup=[...new Set(roster.map(r=>r.name))]; c.artistListMode="additive";c.lineupScope="announcement";
  // Grid placement or font size is not independently verified headline billing.
  c.status="partial";evidence("lineup",programme,c.lineup.join(" – "));evidence("status",articles[0],plain(articles[0].html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""));
  if (/<a\b[^>]*href=["']\/billetter["'][^>]*>[\s\S]*?Køb billet/i.test(home.html)) {
    c.ticketsUrl=origin+"/billetter";evidence("ticketsUrl",home,"Køb billet: official festival ticket gateway");
  }
  c.warnings.push(ROSKILDE_REVIEW);
  return c;
}
