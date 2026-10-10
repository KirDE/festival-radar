import type { FestivalSource } from "../types.ts";

const origin = "https://dynamo-metalfest.nl";
const lineupUrl = origin + "/line-up/";
const bundleId = "festival-radar-dynamo-bands";
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
const canonical = (html: string) => attr(html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0] ?? "", "href");

export function isDynamoAnnouncement(source: FestivalSource): boolean {
  return source.festivalSlug === "dynamo-metal-fest" && source.strategies.includes("official_markup") && source.url === origin + "/first-names-dmf-27/" && source.editionYear === 2027 && !source.fetchUrl && !source.followLinkPattern;
}

// Fetch only current official artist-card links, never news/navigation or arbitrary
// remote URLs. Each linked document must independently prove edition and identity.
export async function discoverDynamoBands(html: string, fetchPage: (url: string) => Promise<Response>): Promise<string> {
  if (![...html.matchAll(/<a\b[^>]*>/gi)].some(m => attr(m[0], "href") === lineupUrl)) throw new Error("Dynamo official lineup link missing");
  const load = async (url: string) => {
    const response = await fetchPage(url);
    if (!response.ok) throw Object.assign(new Error(`Dynamo linked source HTTP ${response.status}`), { status: response.status });
    if (response.url && response.url !== url) throw new Error("Dynamo linked source redirected away from its official URL");
    const body = await response.text();
    if (body.length > 1_000_000 || canonical(body) !== url) throw new Error("Dynamo linked document identity mismatch");
    return body;
  };
  const lineup = await load(lineupUrl);
  const main = lineup.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  if (!/<h1\b[^>]*>\s*LINE-UP\s*<\/h1>/i.test(main)) throw new Error("Dynamo current lineup heading missing");
  const urls = [...new Set([...main.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(m => /data-widget_type=["']theme-post-title\.default["']/i.test(m[2]))
    .map(m => m[1]).filter(url => /^https:\/\/dynamo-metalfest\.nl\/bands\/[a-z0-9-]+\/$/.test(url)))];
  if (!urls.length || urls.length > 80) throw new Error("Dynamo current lineup cards missing or unbounded");
  const documents = [];
  for (const url of urls) {
    const body = await load(url);
    const bandMain = body.match(/<div\b[^>]*data-elementor-type=["']single-post["'][^>]*>([\s\S]*?)(?:<footer\b|$)/i)?.[1] ?? "";
    const eventJson = body.match(/<script\b(?=[^>]*\bclass=["']dmf-schema["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    let event: unknown;
    try { event = JSON.parse(eventJson ?? ""); } catch { throw new Error("Dynamo artist event schema unavailable"); }
    documents.push({ url, canonical: canonical(body), title: text(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
      heading: text(bandMain.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
      editionLink: [...bandMain.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].some(m => m[1] === lineupUrl && text(m[2]) === "TERUG NAAR LINE-UP 2027"), event });
  }
  return html + `<script type="application/json" id="${bundleId}">${JSON.stringify(documents).replace(/</g, "\\u003c")}</script>`;
}

export function extractDynamoBands(html: string, startDate: string, endDate: string): string[] | undefined {
  const json = html.match(new RegExp(`<script type="application/json" id="${bundleId}">([\\s\\S]*?)<\\/script>`, "i"))?.[1];
  if (!json) return undefined;
  try {
    const docs = JSON.parse(json);
    if (!Array.isArray(docs) || !docs.length || docs.length > 80) return undefined;
    const names: string[] = [];
    for (const doc of docs) {
      const event = doc.event;
      if (typeof doc.heading !== "string" || !doc.heading || doc.heading.length > 100 || /<|>|\b(?:tickets?|line.?up|stage)\b/i.test(doc.heading) ||
        !/^https:\/\/dynamo-metalfest\.nl\/bands\/[a-z0-9-]+\/$/.test(doc.url) || doc.canonical !== doc.url || doc.editionLink !== true ||
        doc.title !== `${doc.heading} - Dynamo Metalfest - ${Number(startDate.slice(8))}, ${Number(startDate.slice(8)) + 1} & ${Number(endDate.slice(8))} August 2027` ||
        event?.["@type"] !== "MusicEvent" || event.url !== doc.url || event.eventStatus !== "https://schema.org/EventScheduled" ||
        event.performer?.["@type"] !== "MusicGroup" || event.performer.name !== doc.heading ||
        typeof event.startDate !== "string" || typeof event.endDate !== "string" ||
        !Number.isFinite(Date.parse(event.startDate)) || !Number.isFinite(Date.parse(event.endDate)) || Date.parse(event.endDate) < Date.parse(event.startDate) ||
        event.startDate.slice(0, 10) < startDate || event.endDate.slice(0, 10) > endDate) return undefined;
      // Known performance suffix on the official artist title, not an identity.
      const name = doc.heading.replace(/^Cavalera\s+[–—-]\s+Ch(?:ao|oa)s A\.D\.$/i, "Cavalera")
        .replace(/^Corrosion Of Conformity$/i, "Corrosion of Conformity").replace(/^Left To Suffer$/i, "Left to Suffer");
      if (names.some(n => n.toLowerCase() === name.toLowerCase())) return undefined;
      names.push(name);
    }
    return names;
  } catch { return undefined; }
}
