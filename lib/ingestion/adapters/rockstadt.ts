import type { FestivalSource } from "../types.ts";

const url = "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/";
const title = "Rockstadt Fest 2027";
const names = ["Slash featuring Myles Kennedy and The Conspirators", "Overkill", "Mgla", "Venom", "Jinjer", "Towards the Sinister"];
const rename = "A new name. The same heartbeat. For more than a decade, you've helped build something far bigger than a festival. What started as Rockstadt Extreme Fest has grown into a community recognized far beyond Romania, and today it takes the next natural step. Starting with the 2027 edition, we become Rockstadt Festival. The stages, the crowds, the atmosphere, the feeling of coming home every summer, none of that changes. This is simply the name that carries us into the next chapter.";
const text = (value: string) => value.replace(/&#0*39;|&apos;/gi, "'").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined);
const hasClass = (tag: string, name: string) => attr(tag, "class")?.split(/\s+/).includes(name) ?? false;

// Require a unique, closed div. Nested divs must close before its own closing
// tag; a truncated details/box cannot borrow an unrelated following block.
function div(html: string, matches: (tag: string) => boolean): string | undefined {
  const openings = [...html.matchAll(/<div\b[^>]*>/gi)].filter((match) => matches(match[0]));
  if (openings.length !== 1) return undefined;
  const opening = openings[0];
  const start = opening.index! + opening[0].length;
  let depth = 1;
  for (const tag of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index!);
  }
  return undefined;
}

export function rockstadt(html: string, source: FestivalSource) {
  if (source.url !== url || source.editionYear !== 2027) return undefined;
  // This is an edition-bound ticket article, never a homepage or generic Event
  // JSON-LD parser. Require a complete document and independently matching OG.
  if (!/<\/body>\s*<\/html>\s*$/i.test(html)) return undefined;
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const head = clean.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!head) return undefined;
  const expected: Record<string, string> = { "og:url": url, "og:type": "article", "og:title": title };
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  for (const [property, value] of Object.entries(expected)) {
    const tags = metas.filter((tag) => attr(tag, "property") === property);
    if (tags.length !== 1 || attr(tags[0], "content") !== value) return undefined;
  }
  const descriptions = metas.filter((tag) => attr(tag, "property") === "og:description");
  if (descriptions.length > 1 || descriptions.some((tag) => text(attr(tag, "content") ?? "") !== "26-30 iul '27, Rockstadt Fest, Ghimbav (Brașov)")) return undefined;
  const titles = [...head.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)];
  if (titles.length > 1 || titles.some((match) => text(match[1]) !== "Bilete Rockstadt Fest 2027 - 26-30 iul '27 - Rockstadt Fest")) return undefined;
  const canonicals = [...head.matchAll(/<link\b[^>]*>/gi)].filter((match) => attr(match[0], "rel") === "canonical");
  if (canonicals.length > 1 || canonicals.some((match) => attr(match[0], "href") !== url)) return undefined;

  // If the ticket host's event metadata is present, it must corroborate every
  // field. JSON-LD, navigation and footer cannot supply missing article facts.
  const metadata = [...clean.matchAll(/dataLayer\.push\((\{"pageData"[\s\S]*?)\);/g)];
  if ((clean.match(/"pageData"\s*:/g) ?? []).length !== metadata.length || metadata.length > 1) return undefined;
  for (const match of metadata) {
    try {
      const { event, venue } = JSON.parse(match[1]).pageData;
      if (event.id !== "129242" || event.title !== title || event.start_date !== "2027-07-26" || event.end_date !== "2027-07-30" || venue.name !== "Rockstadt Fest" || venue.town !== "Ghimbav (Brașov)") return undefined;
    } catch { return undefined; }
  }

  const body = clean.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    .replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!body) return undefined;
  let depth = 0;
  for (const tag of body.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth < 0 || /\/\s*>$/.test(tag[0])) return undefined;
  }
  if (depth !== 0) return undefined;
  // The verified heading and details live in sibling boxes of this event
  // column. Keep both anchors in that column, excluding other event cards.
  const box = div(body, (tag) => hasClass(tag, "col-md-8") && hasClass(tag, "slot") && hasClass(tag, "col-md-push-4"));
  const dateTag = box?.match(/^\s*<div class="box">\s*<h1>Rockstadt Fest 2027<\/h1>\s*(<div\b[^>]*>)/i)?.[1];
  if (!box || !dateTag || !hasClass(dateTag, "date-location") || (box.match(/<h1\b/gi) ?? []).length !== 1) return undefined;
  const location = div(box, (tag) => hasClass(tag, "date-location"));
  if (!location || !/^\s*<p>\s*<strong>Rockstadt Fest, Ghimbav \(Brașov\)<\/strong>\s*<\/p>\s*<p>\s*26-30 iulie (?:'|&#0*39;)27\s*<\/p>\s*$/.test(location)) return undefined;
  const details = div(box, (tag) => attr(tag, "id") === "details");
  if (!details) return undefined;
  const description = div(details, (tag) => hasClass(tag, "event-short-desc"));
  if (!description || (box.match(/First confirmed names:/g) ?? []).length !== 1 || (box.match(/\bevent-short-desc\b/g) ?? []).length !== 1) return undefined;
  // Only the verified bold list is supported. Extra names, nested markup,
  // duplicate announcements and malformed closing tags all fail closed.
  const announcement = description.match(/First confirmed names:\s*<strong>([^<>]+)<\/strong>/);
  if (!announcement || text(announcement[1]) !== names.join(", ")) return undefined;
  const prose = description.replace(announcement[0], "").replace(/<br\s*\/?\s*>/gi, " ");
  if (/[<>]/.test(prose)) return undefined;
  // Pin the surrounding announcement prose too: an appended second artist
  // paragraph must not silently expand this known six-name announcement.
  if (text(description.slice(0, announcement.index!).replace(/<br\s*\/?\s*>/gi, " ")) !== rename ||
      text(description.slice(announcement.index! + announcement[0].length).replace(/<br\s*\/?\s*>/gi, " ")) !== "One community. One heart. One new chapter. See you at Rockstadt Festival!") return undefined;
  return { editionYear: 2027, startDate: "2027-07-26", endDate: "2027-07-30", city: "Ghimbav (Brașov)", lineup: [...names],
    excerpt: `${title}; 26-30 iulie '27; Ghimbav (Brașov); Starting with the 2027 edition, we become Rockstadt Festival. First confirmed names: ${names.join(", ")}` };
}
