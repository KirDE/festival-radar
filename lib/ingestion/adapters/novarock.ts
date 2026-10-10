import type { FestivalSource } from "../types.ts";

const url = "https://www.novarock.at/lineup/";
const canonical = "https://www.novarock.at/event/nova-rock-2027-pannonia-fields-2027-06-09/";
const days = ["2027-06-09", "2027-06-10", "2027-06-11", "2027-06-12"];
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&apos;|&#0*39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);|&#x([\da-f]+);/gi, (_, decimal: string, hex: string) => {
    const code = decimal ? Number(decimal) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
  }).replace(/\s+/g, " ").trim();

// Small strict tokenizer for this observed markup, not a forgiving browser DOM.
// Duplicate attributes, unclosed/nested cards and borrowed closing tags fail.
function attrs(tag: string): Record<string, string> | undefined {
  const rest = tag.replace(/^<[a-z][\w:-]*\b/i, "").replace(/\/?\s*>$/, "");
  const result: Record<string, string> = {};
  let end = 0;
  for (const m of rest.matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
    if (rest.slice(end, m.index).trim()) return undefined;
    const key = m[1].toLowerCase();
    if (Object.hasOwn(result, key)) return undefined;
    result[key] = decode(m[2] ?? m[3] ?? "");
    end = m.index! + m[0].length;
  }
  return rest.slice(end).trim() ? undefined : result;
}
type Node = { tag: string; a: Record<string, string>; children: Node[]; text: string; raw: string };
const hasClass = (n: Node, name: string) => n.a.class?.split(/\s+/).includes(name) ?? false;
const descendants = (n: Node): Node[] => n.children.flatMap((child) => [child, ...descendants(child)]);
function tree(html: string): Node | undefined {
  const root: Node = { tag: "root", a: {}, children: [], text: "", raw: "" };
  const stack = [root];
  const voids = new Set(["img", "source", "br", "hr", "input", "meta", "link", "wbr"]);
  let end = 0;
  for (const m of html.matchAll(/<[^>]*>/g)) {
    const text = html.slice(end, m.index);
    if (text.includes("<")) return undefined;
    stack.at(-1)!.text += text;
    end = m.index! + m[0].length;
    const close = m[0].match(/^<\/([a-z][\w:-]*)\s*>$/i);
    if (close) {
      if (stack.length === 1 || stack.at(-1)!.tag !== close[1].toLowerCase()) return undefined;
      stack.pop();
      continue;
    }
    const tag = m[0].match(/^<([a-z][\w:-]*)\b/i)?.[1].toLowerCase();
    const a = attrs(m[0]);
    if (!tag || !a || ["script", "style", "template", "noscript"].includes(tag) ||
        (!voids.has(tag) && /\/\s*>$/.test(m[0])) ||
        Object.keys(a).some((key) => ["hidden", "inert"].includes(key)) || a["aria-hidden"] === "true" ||
        /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s|;|$)/i.test(a.style ?? "")) return undefined;
    const node: Node = { tag, a, children: [], text: "", raw: m[0] };
    stack.at(-1)!.children.push(node);
    if (!voids.has(tag)) stack.push(node);
  }
  if (stack.length !== 1 || html.slice(end).includes("<")) return undefined;
  root.text += html.slice(end);
  return root;
}

function novarockCards(html: string, source: FestivalSource) {
  if (source.url !== url || source.editionYear !== 2027 ||
      (source.fetchUrl !== undefined && source.fetchUrl !== url) || source.followLinkPattern !== undefined) return undefined;
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  // Scripts are untrusted and never supply document identity or artist evidence.
  const doc = clean.match(/^\s*<!doctype html>\s*<html\b[^>]*>\s*<head\b[^>]*>([\s\S]*?)<\/head>\s*<body\b[^>]*>([\s\S]*?)<\/body>\s*<\/html>\s*$/i);
  if (!doc) return undefined;
  const head = doc[1].replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const body = doc[2].replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if ((clean.match(/<\/?(?:html|head|body)\b/gi) ?? []).length !== 6) return undefined;
  const titles = [...head.matchAll(/<title\b[^>]*>([^<>]*)<\/title>/gi)];
  if (titles.length !== 1 || decode(titles[0][1]) !== "Line-Up 2027 - Nova Rock Festival") return undefined;
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const identities = links.filter((a) => a?.rel === "canonical");
  if (links.some((a) => !a) || identities.length !== 1 || identities[0]?.href !== canonical) return undefined;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  if (metas.some((a) => !a)) return undefined;
  for (const [key, value] of Object.entries({ "og:url": canonical, "og:title": "Nova Rock 2027", "og:type": "article" })) {
    const found = metas.filter((a) => a?.name === key || a?.property === key);
    if (found.length !== 1 || found[0]?.content !== value) return undefined;
  }
  // A sidebar/footer copy of the entire main cannot supply page evidence.
  const excluded: string[] = [];
  for (const m of body.matchAll(/<\/?(?:nav|aside|footer|template|main)\b[^>]*>/gi)) {
    const tag = m[0].match(/^<\/?([a-z]+)/i)![1].toLowerCase();
    if (tag === "main") { if (excluded.length) return undefined; continue; }
    if (m[0].startsWith("</")) { if (excluded.pop() !== tag) return undefined; }
    else excluded.push(tag);
  }
  if (excluded.length) return undefined;
  const mainBlocks = [...body.matchAll(/<main\b[^>]*>[\s\S]*?<\/main\s*>/gi)];
  if (mainBlocks.length !== 1 || (body.match(/<\/?main\b/gi) ?? []).length !== 2 ||
      /<(?:nav|aside|footer|template)\b/i.test(mainBlocks[0][0])) return undefined;
  const parsed = tree(mainBlocks[0][0]);
  const main = parsed?.children[0];
  if (!main || !hasClass(main, "lineupArchive")) return undefined;
  const all = descendants(main);
  const headings = all.filter((n) => n.tag === "h1");
  const headers = main.children.filter((n) => n.tag === "header" && hasClass(n, "lineupArchive__header"));
  if (headers.length !== 1 || headings.length !== 1 || headings[0].children.length ||
      decode(headings[0].text) !== "Line-Up 2027" || !descendants(headers[0]).includes(headings[0])) return undefined;
  const sections = main.children.filter((n) => n.tag === "section" && hasClass(n, "lineupArchive__content"));
  const grids = all.filter((n) => hasClass(n, "eventCollection__items"));
  if (sections.length !== 1 || grids.length !== 1 || grids[0].tag !== "ul" ||
      !descendants(sections[0]).includes(grids[0])) return undefined;
  const grid = grids[0], cards = grid.children;
  // Observed first wave has 44 cards. Smaller/filtered snapshots cannot propose
  // mass removals. Larger valid snapshots and removals above this floor still
  // remain REVIEW, never automatic publication.
  if (grid.text.trim() || cards.length < 44 || cards.length > 160 ||
      all.filter((n) => hasClass(n, "artistCard")).length !== cards.length) return undefined;
  const headliners: string[] = [], lineup: string[] = [], seen = new Set<string>(), hrefs = new Set<string>(), observedDays = new Set<string>();
  let firstEvidence = "";
  for (const card of cards) {
    const classes = card.a.class?.split(/\s+/) ?? [];
    const billing = classes.filter((c) => c.startsWith("artistCollection__artist--"));
    const day = card.a["data-filter-day"];
    if (card.tag !== "li" || !hasClass(card, "artistCard") || !hasClass(card, "artistCollection__artist") ||
        billing.length !== 1 || !["artistCollection__artist--headliner", "artistCollection__artist--support"].includes(billing[0]) ||
        !days.includes(day) || card.text.trim() || card.children.length !== 1 || card.children[0].tag !== "a") return undefined;
    const anchor = card.children[0], href = anchor.a.href;
    if (!href || !/^https:\/\/www\.novarock\.at\/artist\/[a-z0-9-]+\/$/.test(href) || hrefs.has(href)) return undefined;
    // Pin the visible card shape. Unknown prose, captions or extra links are
    // drift, rather than silently ignored potential artist evidence.
    const [figure, content] = anchor.children;
    if (anchor.children.length !== 2 || !(figure.tag === "figure" && hasClass(figure, "artistCard__image") ||
          figure.tag === "div" && hasClass(figure, "artistCard__image--placeholder") && !figure.children.length && !figure.text.trim()) ||
        content.tag !== "div" || !hasClass(content, "artistCard__content") || content.text.trim() ||
        content.children.length !== 2 || !hasClass(content.children[1], "artistCard__meta") ||
        content.children[1].children.length || content.children[1].text.trim()) return undefined;
    if (figure.tag === "figure") {
      const picture = figure.children[0];
      if (figure.text.trim() || figure.children.length !== 1 || picture.tag !== "picture" || picture.text.trim() ||
          picture.children.filter((n) => n.tag === "img").length !== 1 ||
          picture.children.some((n) => !["source", "img"].includes(n.tag))) return undefined;
    }
    const contents = descendants(anchor);
    const names = contents.filter((n) => hasClass(n, "artistCard__title"));
    if (names.length !== 1 || names[0].tag !== "h2" || names[0].children.length ||
        contents.filter((n) => ["a", "li", "h1", "h2", "h3"].includes(n.tag)).length !== 1 || anchor.text.trim()) return undefined;
    // Official /artist/static-x/ biography explicitly identifies this act as Static-X.
    const visibleName = decode(names[0].text);
    const name = href === "https://www.novarock.at/artist/static-x/" && visibleName === "Static X" ? "Static-X" : visibleName;
    if (!name || name.length > 100 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,:!+?()/\-]*$/u.test(name) || /[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufffd]/u.test(name) ||
        /&[a-z#\d]+;/i.test(name) || /\b(?:19|20)\d{2}\b/.test(name) || seen.has(name.toLowerCase())) return undefined;
    seen.add(name.toLowerCase()); hrefs.add(href); observedDays.add(day);
    (billing[0].endsWith("--headliner") ? headliners : lineup).push(name);
    if (!firstEvidence) firstEvidence = `${card.raw} <a href="${href}"><h2 class="artistCard__title">${name}</h2>`;
  }
  if (observedDays.size !== 4 || !headliners.length || !lineup.length) return undefined;
  return { editionYear: 2027, startDate: days[0], endDate: days[3], headliners, lineup,
    excerpt: `Line-Up 2027; canonical ${canonical}; ${cards.length} closed official cards; data-filter-day ${days.join(", ")}; ${firstEvidence}`,
    warning: "Agent review required before lineup-triggered provider activity" };
}


export const novarockTicketsUrl = "https://www.novarock.at/tickets/";
export function novarockDocuments(lineup: string, tickets: string): string {
  return JSON.stringify({ format: "novarock-documents-v1", lineup, tickets });
}

function ticketOffer(html: string, year: number) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const canonicalLinks = [...clean.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a?.rel === "canonical");
  if (canonicalLinks.length !== 1 || canonicalLinks[0]?.href !== novarockTicketsUrl) return undefined;
  // Each product has nested offer <li>s. Bound by the next product, not the
  // first </li>, so a VIP/caravan sellout can never affect the standard pass.
  const mainBlocks = [...clean.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/gi)];
  if (mainBlocks.length !== 1) return undefined;
  const main = mainBlocks[0][0];
  const products = [...main.matchAll(/<li\b[^>]*class=["'][^"']*\bticketCard\b[^"']*["'][^>]*>/gi)];
  const matches = products.map((m, i) => main.slice(m.index, products[i + 1]?.index ?? main.length))
    .filter(block => [...block.matchAll(/<h3\b[^>]*class=["'][^"']*ticketCard__title[^"']*["'][^>]*>([^<>]*)<\/h3>/gi)]
      .some(m => decode(m[1]) === `Festivalpass ${year}`));
  if (matches.length !== 1) return undefined;
  const productAttrs = attrs(matches[0].match(/^<li\b[^>]*>/i)![0]);
  if (!productAttrs || ["hidden", "inert"].some(key => Object.hasOwn(productAttrs, key)) || productAttrs["aria-hidden"] === "true" || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(productAttrs.style ?? "")) return undefined;
  const titles = [...matches[0].matchAll(/<h3\b[^>]*class=["'][^"']*ticketCard__title[^"']*["'][^>]*>([^<>]*)<\/h3>/gi)];
  if (titles.length !== 1 || decode(titles[0][1]) !== `Festivalpass ${year}`) return undefined;
  const offers = [...matches[0].matchAll(/<li\b[^>]*class=["'][^"']*\bticketCard__offer\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)]
    .map(m => tree(m[0])?.children[0]).filter(n => n && descendants(n).some(c => c.tag === "h4" && hasClass(c, "ticketCard__offerTitle") && !c.children.length && decode(c.text) === "Festivalpass"));
  if (offers.length !== 1) return undefined;
  const offer = offers[0]!, nodes = descendants(offer);
  const links = nodes.filter(n => n.tag === "a");
  const available = hasClass(offer, "is:available"), soldOut = hasClass(offer, "is:sold_out");
  const price = nodes.find(n => hasClass(n, "ticketCard__offerInfoPrice"));
  const value = price && descendants(price).find(n => n.tag === "strong");
  const purchase = links.length === 1 ? links[0] : undefined;
  let trusted = false;
  try {
    const target = new URL(purchase?.a.href ?? "");
    trusted = target.protocol === "https:" && target.hostname === "www.oeticket.com" && !target.username && !target.password && !target.port && new RegExp(`^/noapp/event/nova-rock-${year}-[^/]+/`).test(target.pathname);
  } catch { /* No purchase target. */ }
  if (available && !soldOut && value && /^\d+(?:[.,]\d{2})?$/.test(decode(value.text)) && Number(decode(value.text).replace(",", ".")) > 0 && trusted && decode(purchase!.text) === "Jetzt kaufen") {
    return { ticketsUrl: novarockTicketsUrl, ticketStatus: "available" as const, ticketsExcerpt: `Festivalpass ${year}; Festivalpass EUR ${decode(value.text)}; Jetzt kaufen; ${purchase!.a.href}` };
  }
  if (soldOut && !available && !links.length && nodes.some(n => hasClass(n, "ticketCard__offerInfoNotice") && decode(n.text) === "Sold Out!")) {
    return { ticketsUrl: novarockTicketsUrl, ticketStatus: "unavailable" as const, ticketsExcerpt: `Festivalpass ${year}; Festivalpass Sold Out!` };
  }
  return undefined;
}

export function novarock(document: string, source: FestivalSource) {
  let html = document, tickets: string | undefined;
  if (document.startsWith("{")) {
    try {
      const envelope = JSON.parse(document);
      if (envelope.format !== "novarock-documents-v1" || typeof envelope.lineup !== "string" || typeof envelope.tickets !== "string") return undefined;
      html = envelope.lineup; tickets = envelope.tickets;
    } catch { return undefined; }
  }
  const result = novarockCards(html, source);
  if (!result) return undefined;
  return { ...result, ...(tickets ? ticketOffer(tickets, result.editionYear) : {}) };
}
