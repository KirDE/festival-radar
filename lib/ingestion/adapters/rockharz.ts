import type { FestivalCandidate, FestivalSource } from "../types.ts";

const origin = "https://www.rockharz-festival.com";
const bandsUrl = `${origin}/bands`;
const headlinerUrl = `${origin}/headliner-alarm`;
const soldoutUrl = `${origin}/das-rockharz-2027-ist-ausverkauft`;
const marketUrl = "https://ticketmarktplatz.rockharz-festival.com/";
const heading = "Alle bisher bestätigten Bands des 2027er Line-Up!";
const baseline = [
  "ACCEPT", "ALESTORM", "ALL FOR METAL", "ARCH ENEMY", "BRUCE DICKINSON",
  "COPPELIUS", "DARTAGNAN", "DUST BOLT", "EISBRECHER", "EMIL BULLS", "EQUILIBRIUM",
  "GRAVE DIGGER", "GUTALAX", "GWAR", "H-BLOCKX", "HANDGEMENG", "IGELS VS. SHARK",
  "KATERFAHRT", "KORPIKLAANI", "LORD OF THE LOST", "MARDUK", "METAL CHURCH", "NESTOR",
  "SETYOURSAILS", "SKALD", "STORMSEEKER", "TANKARD", "THE SISTERS OF MERCY", "TURBOBIER",
];
// Exact reviewed 2027 tile aliases: the first-wave article confirms singular
// IGEL VS. SHARK and SETYØURSAILS; SKÁLD is the artist spelling (the article
// itself inconsistently uses SKĀLD/SKÀLD). These do not authorize generic
// accent folding or fuzzy matching. Changed captions/assets fail closed.
const reviewedAliases: Record<string, { canonical: string; asset: string }> = {
  "IGELS VS. SHARK": { canonical: "IGEL VS. SHARK", asset: "igelvsshark_v1a" },
  SETYOURSAILS: { canonical: "SETYØURSAILS", asset: "setyoursails_v1a" },
  SKALD: { canonical: "SKÁLD", asset: "skald_v1a" },
};
const decode = (value: string) => value.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
  .replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/&#(\d+);/g, (_, n: string) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "\ufffd");
const plain = (value: string) => decode(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// The live lightbox anchor repeats exactly this class twice. No other
// duplicate attribute (including identical title/href) is acceptable.
function attrs(tag: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  const rest = tag.replace(/^<\w+\b/, "").replace(/\/?\s*>$/, "");
  let end = 0;
  let repeatedClass = false;
  for (const m of rest.matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (rest.slice(end, m.index).trim()) return undefined;
    const key = m[1].toLowerCase(), value = m[2] ?? m[3];
    if (Object.hasOwn(result, key)) {
      if (key !== "class" || !/^<a\b/i.test(tag) || value !== "ngg-simplelightbox" ||
          result[key] !== value || repeatedClass) return undefined;
      repeatedClass = true;
    }
    result[key] = value;
    end = m.index! + m[0].length;
  }
  return rest.slice(end).trim() ? undefined : result;
}
const visible = (a: Record<string, string> | undefined) => !!a && a["aria-hidden"] !== "true" &&
  !Object.keys(a).some((key) => ["hidden", "inert"].includes(key)) &&
  !/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/i.test(a.style ?? "");
const hasClass = (tag: string, name: string) => attrs(tag)?.class?.split(/\s+/).includes(name) ?? false;
type Block = { tag: string; content: string; start: number; end: number };

// All boundaries of the requested element must balance before a closed block
// can supply evidence. Parse only relevant attributes, not unrelated widgets.
function blocks(html: string, element: string): Block[] | undefined {
  const stack: { tag: string; start: number; contentStart: number }[] = [];
  const result: Block[] = [];
  for (const m of html.matchAll(new RegExp(`<\\/?${element}\\b[^>]*>`, "gi"))) {
    if (/^<\//.test(m[0])) {
      if (!new RegExp(`^</${element}\\s*>$`, "i").test(m[0])) return undefined;
      const open = stack.pop();
      if (!open) return undefined;
      result.push({ tag: open.tag, content: html.slice(open.contentStart, m.index), start: open.start, end: m.index! + m[0].length });
    } else {
      if (/\/\s*>$/.test(m[0])) return undefined;
      stack.push({ tag: m[0], start: m.index!, contentStart: m.index! + m[0].length });
    }
  }
  return stack.length ? undefined : result.sort((a, b) => a.start - b.start);
}
function uniqueDiv(html: string, matches: (tag: string) => boolean): Block | undefined {
  const found = blocks(html, "div")?.filter((block) => matches(block.tag));
  return found?.length === 1 ? found[0] : undefined;
}
function documentParts(html: string) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  if (!/^\s*(?:<!doctype html>\s*)?<html\b[^>]*>[\s\S]*<\/html>\s*$/i.test(clean)) return undefined;
  for (const tag of ["html", "head", "body"]) {
    if ((clean.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length !== 1 ||
        (clean.match(new RegExp(`</${tag}\\s*>`, "gi")) ?? []).length !== 1) return undefined;
  }
  const doc = clean.match(/<html\b[^>]*>\s*<head\b[^>]*>([\s\S]*?)<\/head>\s*<body\b[^>]*>([\s\S]*?)<\/body>\s*<\/html>\s*$/i);
  if (!doc) return undefined;
  return {
    head: doc[1].replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ""),
    body: doc[2].replace(/<(nav|header)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "<unsupported-content>"),
  };
}
function identity(head: string, url: string, published?: string): boolean {
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  if (links.some((a) => !a) || metas.some((a) => !a)) return false;
  const canonical = links.filter((a) => a?.rel === "canonical");
  if (canonical.length !== 1 || canonical[0]?.href !== url) return false;
  for (const [property, value] of Object.entries({ "og:url": url, ...(published ? { "article:published_time": published } : {}) })) {
    const tags = metas.filter((a) => a?.property === property);
    if (tags.length !== 1 || tags[0]?.content !== value) return false;
  }
  return true;
}
function post(body: string, id: string, title: string): string | undefined {
  // Footer/sidebar cannot stand in for the edition-bound post.
  const clean = body.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, "");
  const article = uniqueDiv(clean, (tag) => attrs(tag)?.id === id);
  if (!article || !visible(attrs(article.tag))) return undefined;
  const titles = [...article.content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (titles.length !== 1 || plain(titles[0][1]) !== title) return undefined;
  const content = uniqueDiv(article.content, (tag) => hasClass(tag, "entry-content") && hasClass(tag, "clearfix"));
  return content && visible(attrs(content.tag)) && content.start > titles[0].index! ? content.content : undefined;
}
function asset(value: string | undefined, prefix: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, bandsUrl);
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !new RegExp(`^/wp-content/uploads/\\d{4}/\\d{2}/rhz2027_web_${prefix}_[a-z0-9_-]+\\.(?:jpg|jpeg|png|webp)$`, "i").test(parsed.pathname)) return undefined;
    return parsed.href;
  } catch { return undefined; }
}
function bands(content: string) {
  const headings = [...content.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  if (headings.length !== 1 || plain(headings[0][1]) !== heading) return undefined;
  const grid = uniqueDiv(content, (tag) => attrs(tag)?.id === "content");
  if (!grid || !visible(attrs(grid.tag)) || content.slice(0, grid.start).trim() !== headings[0][0].trim() || content.slice(grid.end).trim()) return undefined;
  const tiles = blocks(grid.content, "div")?.filter((b) => hasClass(b.tag, "band_item"));
  if (!tiles || tiles.length < baseline.length || tiles.length > 150) return undefined;
  const names: string[] = [], assets = new Set<string>();
  let end = 0;
  for (const tile of tiles) {
    const tileAttrs = attrs(tile.tag);
    if (!tileAttrs || Object.keys(tileAttrs).length !== 1 || tileAttrs.class !== "band_item") return undefined;
    if (grid.content.slice(end, tile.start).trim() || tile.start < end) return undefined;
    end = tile.end;
    // Pin the observed p/lightbox/img and inert social wrapper shape. No
    // secondary caption, hidden artist or unexpected card can expand the grid.
    const match = tile.content.match(/^\s*<p>\s*(<a\b[^>]*>)\s*(<img\b[^>]*>)\s*<\/a>\s*<\/p>\s*<div class="bandsocials">\s*<div class="clearfloat">\s*(?:&nbsp;|&#160;|\s)*<\/div>\s*<\/div>\s*$/i);
    if (!match) return undefined;
    const anchor = attrs(match[1]), image = attrs(match[2]);
    const name = anchor?.title ? decode(anchor.title).trim() : "";
    if (!anchor || !image || !visible(anchor) || !visible(image) || anchor.class !== "ngg-simplelightbox" || anchor.rel !== "band" ||
        !name || name.length > 100 || /[<>\[\]{}\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/u.test(name) ||
        !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,:!+?()/\-]*$/u.test(name) ||
        names.some((n) => n.toLowerCase() === name.toLowerCase()) ||
        ["GRAVE DIIGGER", "SKĀLD", "SKÀLD"].includes(name.toUpperCase())) return undefined;
    const news = asset(anchor.href, "news_band-announce"), thumbnail = asset(image.src, "linkespalte");
    if (!news || !thumbnail || assets.has(news) || assets.has(thumbnail)) return undefined;
    const reviewed = reviewedAliases[name];
    if (reviewed && (!new URL(news).pathname.endsWith(`/rhz2027_web_news_band-announce_${reviewed.asset}.jpg`) ||
        !new URL(thumbnail).pathname.endsWith(`/rhz2027_web_linkespalte_${reviewed.asset}.jpg`))) return undefined;
    assets.add(news); assets.add(thumbnail); names.push(name);
  }
  if (grid.content.slice(end).trim() || baseline.some((name) => !names.includes(name))) return undefined;
  const additions = names.filter((name) => !baseline.includes(name));
  const canonical = names.map((name) => reviewedAliases[name]?.canonical ?? name);
  if (new Set(canonical.map((name) => name.toLocaleLowerCase())).size !== canonical.length) return undefined;
  return { editionYear: 2027, lineup: canonical,
    excerpt: `${heading}; ${names.length} closed band_item anchor titles; exact reviewed aliases: IGELS VS. SHARK → IGEL VS. SHARK, SETYOURSAILS → SETYØURSAILS, SKALD → SKÁLD; all 29 reviewed baseline captions present: ${names.join(", ")}`,
    ...(additions.length ? { warning: `New Rockharz captions are provisional and require independent artist review: ${additions.join(", ")}` } : {}) };
}
function marketplace(head: string, body: string) {
  const titles = [...head.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi)];
  if (titles.length !== 1 || plain(titles[0][1]) !== "ROCKHARZ Ticketmarktplatz 2027") return undefined;
  // This host has no canonical/OG in the observed markup. If introduced, they
  // must corroborate the exact configured URL rather than change its identity.
  let canonicalCount = 0, ogCount = 0;
  for (const tag of head.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const a = attrs(tag[0]);
    if (a?.rel === "canonical") canonicalCount++;
    if (a?.property === "og:url") ogCount++;
    if (canonicalCount > 1 || ogCount > 1 || !a || (a.rel === "canonical" && a.href !== marketUrl) || (a.property === "og:url" && a.content !== marketUrl)) return undefined;
  }
  const main = blocks(body.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ""), "main")?.filter((b) => attrs(b.tag)?.id === "top");
  if (main?.length !== 1) return undefined;
  const hero = uniqueDiv(main[0].content, (tag) => hasClass(tag, "hero"));
  if (!hero || !visible(attrs(hero.tag))) return undefined;
  const match = hero.content.match(/^\s*<img\b[^>]*>\s*<h1 class="poster display">Ticketmarktplatz<\/h1>\s*<p class="kicker mt-1">([^<>]*)<\/p>\s*$/i);
  if (!match) return undefined;
  const statement = plain(match[1]);
  const range = statement.match(/^(\d{1,2})\.\s*[–-]\s*(\d{1,2})\. ([\p{L}]+) (2027) · ([\p{L}\p{N}][\p{L}\p{N} .’'()/-]{0,79})$/u);
  const months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  if (!range) return undefined;
  const month = months.indexOf(range[3]);
  if (month < 0) return undefined;
  const city = range[5];
  const start = new Date(Date.UTC(2027, month, Number(range[1]))), finish = new Date(Date.UTC(2027, month, Number(range[2])));
  const days = (finish.getTime() - start.getTime()) / 86400000;
  if (start.getUTCMonth() !== month || finish.getUTCMonth() !== month || days < 1 || days > 7) return undefined;
  // A unique bounded footer must corroborate the full date/city statement.
  // It cannot supply missing hero facts or excuse another conflicting range.
  const footers = blocks(body, "footer");
  if (footers?.length !== 1) return undefined;
  const dateParagraphs = (value: string) => blocks(value, "p")?.filter((p) => /^\d{1,2}\.\s*[–-]\s*\d{1,2}\./.test(plain(p.content)));
  const repeated = dateParagraphs(footers[0].content);
  const all = dateParagraphs(body);
  if (repeated?.length !== 1 || plain(repeated[0].content) !== statement || !all || all.some((p) => plain(p.content) !== statement)) return undefined;
  return { editionYear: 2027, startDate: start.toISOString().slice(0, 10), endDate: finish.toISOString().slice(0, 10), city,
    excerpt: `ROCKHARZ Ticketmarktplatz 2027; corroborated hero/footer: ${statement}`,
    ...(city !== "Ballenstedt" ? { warning: "Rockharz venue city changed from reviewed Ballenstedt; independent review required" } : {}) };
}
export function rockharz(html: string, source: FestivalSource) {
  if (![bandsUrl, headlinerUrl, marketUrl, soldoutUrl].includes(source.url) || source.editionYear !== 2027 ||
      (source.fetchUrl !== undefined && source.fetchUrl !== source.url) || source.followLinkPattern !== undefined) return undefined;
  const doc = documentParts(html);
  if (!doc || !blocks(doc.body, "div")) return undefined;
  if (source.url === marketUrl) return marketplace(doc.head, doc.body);
  const published = source.url === headlinerUrl ? "2026-10-07T14:30:22+00:00" : source.url === soldoutUrl ? "2026-07-09T15:33:09+00:00" : undefined;
  if (!identity(doc.head, source.url, published)) return undefined;
  if (source.url === bandsUrl) {
    const content = post(doc.body, "post-65077", "Bands");
    return content ? bands(content) : undefined;
  }
  if (source.url === headlinerUrl) {
    const content = post(doc.body, "post-84153", "HEADLINER-ALARM!");
    const paragraphs = content ? blocks(content, "p") : undefined;
    const sentence = "AMON AMARTH sind Headliner beim ROCKHARZ 2027!";
    const billing = paragraphs?.filter((p) => /\bheadliner\b/i.test(plain(p.content)));
    if (billing?.length !== 1 || plain(billing[0].content) !== sentence || /<[^>]*>/.test(billing[0].content)) return undefined;
    return { editionYear: 2027, headliners: ["AMON AMARTH"], excerpt: `HEADLINER-ALARM!; ${published}; ${sentence}` };
  }
  const content = post(doc.body, "post-82346", "DAS ROCKHARZ 2027 IST AUSVERKAUFT!");
  const sentence = "Es ist vollbracht! Alle zur Verfügung stehenden Festivaltickets für das ROCKHARZ 2027 sind vergriffen!";
  const statements = content ? blocks(content, "div")?.filter((b) => !/<[^>]*>/.test(b.content) && plain(b.content).includes("Festivaltickets")) : undefined;
  if (statements?.length !== 1 || plain(statements[0].content) !== sentence) return undefined;
  return { editionYear: 2027, ticketStatus: "unavailable" as FestivalCandidate["ticketStatus"],
    excerpt: `DAS ROCKHARZ 2027 IST AUSVERKAUFT!; ${published}; ${sentence}` };
}
