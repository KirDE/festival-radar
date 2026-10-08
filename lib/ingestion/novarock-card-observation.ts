import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canonicalNovaContent, digestNovaRockContent, verifyNovaRockContentSealInTransaction } from "./novarock-content-seal.ts";
import { acquisitionMatchesSource, readAcquisitionProvenance } from "./provenance.ts";

const URL = "https://www.novarock.at/lineup/";
const CANONICAL = "https://www.novarock.at/event/nova-rock-2027-pannonia-fields-2027-06-09/";
const DAYS = ["2027-06-09", "2027-06-10", "2027-06-11", "2027-06-12"] as const;
export const NOVA_CARD_DOCUMENT_MAX_BYTES = 512 * 1024;
export type NovaRockObservedCard = {
  caption: string; officialUrl: string; day: typeof DAYS[number]; billing: "HEADLINER" | "LINEUP"; position: number;
};
type Element = { tag: string; attrs: Record<string, string>; children: Element[]; text: string };
const fail = (reason: string): never => { throw new Error(`Nova card observation: ${reason}`); };
const equal = (a: unknown, b: unknown) => canonicalNovaContent(a) === canonicalNovaContent(b);

// Independent fail-closed grammar. Does not import or invoke the ingestion adapter.
// The inspected 2026-10-08 original page contains rawtext blocks. Their exact
// byte-equivalent UTF-8 fingerprints are a syntax allowance, NOT provenance.
// Matching these bytes does not attest to browser behavior; changed blocks reject.
const observedOpaqueFingerprints = new Set([
  'fdf5fab68473979d5a6e41c7e5551c400078e85c0b90dc507eb3de8d0efb0c47',
  '4868ddd2715a929908279a6ce4531b5ac8170ac34f8769146228061c495d2ce7',
  '63c49adee472d30e920632833dd7310771d768321a77edcbcdf942348afd211c',
  '83c6b5e286e9b33c226150573e6bad683068ab0422fe57983b4d46e53874e302',
  'a3a1794f195ff5606497ab94eddf14bc1512a5789493c77a121136f4f1bd5fa7',
  '035636d292a60d80dbaf81b323d99b344a9e3208b82a385746e6eba2c32ac780',
  '0b78b0250ab073cb0bb957adcbefc1e3ea91a057542e8040a5d8cc2ade328797',
  'dfdef620acc6fe5fccdfd2aa6239e32bfed6a2a7cfdd6691f162d68f9a7c7b9e',
  'c80a588097178cd1953f8e856ffb53ab87f49961575711ce2ebc070c5060454a',
  '07ee1575755f85f31f5a227448b895b421ec8a44b8e1e685e5840cc2cccd3793',
  '665e864dcddd1c861e007572054304c63169e7a34e0cc72330684b9a63b33aa4',
  '02357d83bc8d7c9e640752bc476d5170448819fbb8f4ab6783d8d91e3d0d0ab8',
  'd924be09c93e9369c7c203d31bee4dcf59bb9ba994ecdc943464c15dc12ff72d',
  '9009999721ddd25963da358399d136359d7e32a1c7c74572cc89ba6786eb3163',
  '22d5a036c1f98bfaef50f700bc65ddb72350d772c2864b3e140bed894d2dc4a3',
  'ea131222faa1d58bb4ce4dccf26b34ddd928e017c0b22764a1a9004299ddbfe6',
  '60b86e1c3da39fc1f338cc7fc7635b246b4311b990c8dac8609967ed3c6ad717',
  '2154d6400861ddc42c003c417091640ff4b9045f790e41a222f404af7bf54ffc',
  '72ae0e3c23d80b0695c60c754fe3208250bae3ff03b0db0e064aed9a11c6c802',
  '082e45b0f279b634a3c7e282b2a1b866f3c26383a9a5f6057d248111f39b6e04',
]);
// Unknown entities, declarations, unreviewed rawtext and malformed nesting
// are drift. This accepts a narrower profile than a browser or the adapter.
function decode(text: string): string {
  const decoded = text.replace(/&([^;\s]+);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">" };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) return fail("unknown entity");
    const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (n < 32 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) return fail("invalid entity");
    return String.fromCodePoint(n);
  });
  return decoded.normalize("NFC").replace(/\s+/gu, " ").trim();
}
function documentTree(html: string): Element {
  if (!/^\s*<!doctype html>/i.test(html)) fail("missing doctype");
  html = html.replace(/^\s*<!doctype html>/i, "");
  const root: Element = { tag: "root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const voids = new Set(["meta", "link", "img", "source", "br", "hr", "input", "wbr", "area", "embed"]);
  const opaque = new Set(["script", "style", "noscript"]);
  const tags = new Set(["html", "head", "body", "title", "meta", "link", "script", "style", "noscript", "main", "header", "section", "div", "ul", "li", "a", "h1", "h2", "h3", "h4", "p", "strong", "span", "figure", "picture", "source", "img", "button", "form", "input", "footer", "address", "i", "nav", "br", "hr", "wbr"]);
  let cursor = 0, tokens = 0, opaqueCount = 0;
  const seenOpaque = new Set<string>();
  const token = /<!--[^]*?-->|<\/?[a-z][\w:-]*(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*\/?\s*>/gi;
  while (true) {
    const m = token.exec(html);
    if (!m) break;
    if (++tokens > 30000 || stack.length > 64) fail("structural bound exceeded");
    const preceding = html.slice(cursor, m.index);
    if (preceding.includes("<")) fail("malformed document token");
    stack.at(-1)!.text += preceding;
    cursor = token.lastIndex;
    if (m[0].startsWith("<!--")) {
      if (/artistCard|eventCollection__items|lineupArchive|2027-06|Line-Up\s*2027/i.test(m[0])) fail("card marker in comment");
      continue;
    }
    const tag = /^<\/?([\w:-]+)/.exec(m[0])![1].toLowerCase();
    if (m[0].startsWith("</")) {
      if (m[0].toLowerCase() !== `</${tag}>` || stack.length === 1 || stack.at(-1)!.tag !== tag) fail("unbalanced document");
      stack.pop(); continue;
    }
    if (!tags.has(tag)) fail("unsupported active markup");
    if (!voids.has(tag) && /\/\s*>$/.test(m[0])) fail("self-closing container");
    const attrs: Record<string, string> = {};
    for (const a of m[0].replace(/^<[\w:-]+/, "").matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      const key = a[1].toLowerCase();
      if (Object.hasOwn(attrs, key)) fail("duplicate attribute");
      attrs[key] = decode(a[2] ?? a[3] ?? "");
    }
    if (Object.keys(attrs).some((key) => ["hidden", "inert", "popover"].includes(key) || /^on[a-z]+$/.test(key)) ||
        attrs["aria-hidden"] !== undefined && attrs["aria-hidden"] !== "false") fail("hidden or executable attribute");
    // Allow only inert presentational properties actually present in the page.
    if (attrs.style !== undefined && (!/^(?:(?:color|background-color|border-color|margin-top|margin-bottom):(?:#[a-f0-9]{6}|0|transparent);?)+$/i.test(attrs.style) &&
        attrs.style !== "--wp--custom--section-label--color: var(--colorTheme--text-muted); --wp--custom--section-label--border-color: var(--colorTheme--text-muted)")) fail("unsafe inline style");
    const node: Element = { tag, attrs, children: [], text: "" };
    stack.at(-1)!.children.push(node);
    if (opaque.has(tag)) {
      if (++opaqueCount > 24) fail("opaque count bound");
      const close = new RegExp(`</${tag}\\s*>`, "gi"); close.lastIndex = cursor;
      const end = close.exec(html);
      if (end === null) throw new Error("Nova card observation: unterminated rawtext");
      if (end.index - cursor > 45000) fail("oversized rawtext");
      const body = html.slice(cursor, end.index);
      if (/artistCard|eventCollection__items|lineupArchive|2027(?:-06|\b)|data-filter-day/i.test(body)) fail("card/year marker in rawtext");
      const opaqueBytes = html.slice(m.index, close.lastIndex);
      const digest = createHash("sha256").update(opaqueBytes, "utf8").digest("hex");
      if (!observedOpaqueFingerprints.has(digest) || seenOpaque.has(digest)) fail("unreviewed or duplicate opaque markup");
      seenOpaque.add(digest);
      cursor = close.lastIndex; token.lastIndex = cursor;
    } else if (!voids.has(tag)) stack.push(node);
  }
  if (stack.length !== 1 || html.slice(cursor).includes("<")) fail("incomplete document");
  root.text += html.slice(cursor);
  if (root.text.trim() || root.children.length !== 1 || root.children[0].tag !== "html") fail("document root");
  return root.children[0];
}
const has = (n: Element, c: string) => n.attrs.class?.split(/\s+/).includes(c) ?? false;
const nodes = (n: Element): Element[] => [n, ...n.children.flatMap(nodes)];
function shape(n: Element, tag: string, count: number, cls?: string) {
  if (n.tag !== tag || n.children.length !== count || n.text.trim() || cls && !has(n, cls)) fail(`unexpected ${tag} shape`);
}

/** Pure verification of UNTRUSTED supplied complete bytes, not an HTTP capture,
 * independently re-fetched evidence, timestamp attestation or approval. */
export function verifyNovaRockCardDocument(bytes: Uint8Array, sealedContent: unknown) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > NOVA_CARD_DOCUMENT_MAX_BYTES) fail("document byte bound");
  // Copy once: caller mutation cannot change the bytes between parse and hash.
  const raw = Uint8Array.from(bytes);
  const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  const content = digestNovaRockContent(sealedContent);
  const doc = documentTree(html);
  shape(doc, "html", 2);
  const [head, body] = doc.children;
  if (head.tag !== "head" || head.text.trim()) fail("head shape");
  const titles = head.children.filter((n) => n.tag === "title");
  if (titles.length !== 1 || titles[0].children.length || decode(titles[0].text) !== "Line-Up 2027 - Nova Rock Festival") fail("document title");
  // HTML rel is a case-insensitive, whitespace-separated token list.
  // A second canonical token anywhere in the document is ambiguous.
  const hasCanonicalRel = (n: Element) => n.tag === "link" &&
    (n.attrs.rel ?? "").split(/\s+/).some((token) => token.toLowerCase() === "canonical");
  const canonical = nodes(doc).filter(hasCanonicalRel);
  if (canonical.length !== 1 || canonical[0] !== head.children.find(hasCanonicalRel) ||
      canonical[0].attrs.rel?.toLowerCase() !== "canonical" || canonical[0].attrs.href !== CANONICAL) fail("canonical identity");
  for (const [key, value] of Object.entries({ "og:url": CANONICAL, "og:title": "Nova Rock 2027", "og:type": "article" })) {
    const metas = head.children.filter((n) => n.tag === "meta" && (n.attrs.name === key || n.attrs.property === key));
    if (metas.length !== 1 || metas[0].attrs.content !== value) fail("OG identity");
  }
  if (nodes(doc).filter((n) => n.tag === "title" || hasCanonicalRel(n) ||
      n.tag === "meta" && ["og:url", "og:title", "og:type"].includes(n.attrs.name ?? n.attrs.property ?? "")).length !== 5) fail("duplicate document identity");
  if (body.tag !== "body" || body.text.trim()) fail("body shape");
  // Only div viewport/view wrappers may contain the unique main. Other page
  // chrome is parsed, never discarded; card and grid markers are checked below.
  const mains = nodes(body).filter((n) => n.tag === "main");
  if (mains.length !== 1) fail("main count");
  const main = mains[0]; shape(main, "main", 2, "lineupArchive");
  if (nodes(main).some((n) => ["script", "style", "noscript"].includes(n.tag) ||
      n.attrs.class?.split(/\s+/).some((c) => /^(?:hidden|hide|is-hidden|is:hide|invisible|d-none|sr-only|visually-hidden|opacity-0)$/i.test(c)))) fail("concealed or active card ancestry");
  function reachesMain(n: Element): boolean {
    if (n === main) return true;
    const next = n.children.filter(reachesMain);
    if (next.length > 1 || next.length && n !== body && n.tag !== "div") fail("unsafe main ancestry");
    if (next.length && (n.attrs.style !== undefined || n.attrs.class?.split(/\s+/).some((c) => /^(?:hidden|hide|is-hidden|is:hide|invisible|d-none|sr-only|visually-hidden|opacity-0)$/i.test(c)))) fail("concealed main ancestry");
    return next.length === 1;
  }
  if (!reachesMain(body)) fail("main ancestry");
  const [header, section] = main.children;
  if (header.tag !== "header" || !has(header, "lineupArchive__header") || header.text.trim()) fail("header shape");
  const headings = nodes(header).filter((n) => n.tag === "h1");
  if (headings.length !== 1 || nodes(body).filter((n) => n.tag === "h1").length !== 1) fail("heading count");
  const h1 = headings[0];
  if (h1.children.length || decode(h1.text) !== "Line-Up 2027" || h1.attrs.style && h1.attrs.style !== "margin-bottom:0") fail("visible identity");
  const headerContent = header.children.length === 1 ? header.children[0] : null;
  if (headerContent?.tag === "div" && has(headerContent, "layoutBlock__content")) {
    if (headerContent.children.length !== 1 || !has(headerContent.children[0], "lineup__headerContent") ||
        headerContent.children[0].children[0] !== h1) fail("header wrapper");
  } else if (header.children.length !== 1 || header.children[0] !== h1) fail("header wrapper");
  if (section.tag !== "section" || !has(section, "lineupArchive__content") || section.text.trim()) fail("section shape");
  const grid = section.children.length === 1 && section.children[0].tag === "div" && has(section.children[0], "layoutBlock__content")
    ? (section.children[0].children.length === 1 ? section.children[0].children[0] : fail("grid wrapper"))
    : (section.children.length === 1 ? section.children[0] : fail("grid wrapper"));
  shape(grid, "ul", 44, "eventCollection__items");
  if (nodes(doc).filter((n) => has(n, "eventCollection__items") || has(n, "lineupArchive") || has(n, "lineupArchive__content")).length !== 3) fail("duplicate grid marker");
  const cards: NovaRockObservedCard[] = grid.children.map((li, index) => {
    shape(li, "li", 1, "artistCard");
    const role = li.attrs.class?.split(/\s+/).filter((c) => c.startsWith("artistCollection__artist--"));
    const billing = index < 4 ? "HEADLINER" : "LINEUP";
    if (!has(li, "artistCollection__artist") || !equal(role, [`artistCollection__artist--${index < 4 ? "headliner" : "support"}`])) fail("billing/order");
    const day = li.attrs["data-filter-day"];
    if (!(DAYS as readonly string[]).includes(day)) fail("day");
    const a = li.children[0]; shape(a, "a", 2);
    const officialUrl = a.attrs.href;
    if (!/^https:\/\/www\.novarock\.at\/artist\/[a-z0-9-]+\/$/.test(officialUrl ?? "")) fail("artist URL");
    const [image, caption] = a.children;
    if (image.tag === "figure") {
      shape(image, "figure", 1, "artistCard__image");
      const picture = image.children[0];
      if (picture.tag !== "picture" || picture.text.trim() || picture.children.filter((n) => n.tag === "img").length !== 1 ||
          picture.children.some((n) => !["img", "source"].includes(n.tag) || n.children.length || n.text.trim())) fail("picture");
    } else shape(image, "div", 0, "artistCard__image--placeholder");
    shape(caption, "div", 2, "artistCard__content");
    const [title, meta] = caption.children;
    shape(meta, "div", 0, "artistCard__meta");
    if (title.tag !== "h2" || !has(title, "artistCard__title") || title.children.length) fail("caption shape");
    const name = decode(title.text);
    if (!name || name.length > 100 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,:!+?()/\-]*$/u.test(name) ||
        /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufffd]/u.test(name)) fail("caption");
    return { caption: name, officialUrl, day: day as typeof DAYS[number], billing, position: index < 4 ? index : index - 4 };
  });
  if (nodes(doc).filter((n) => has(n, "artistCard") || has(n, "artistCollection__artist") || has(n, "artistCard__title")).length !== 88 ||
      nodes(doc).filter((n) => n.attrs["data-filter-day"] !== undefined).length !== 44 ||
      nodes(doc).filter((n) => n.tag === "a" && /^https:\/\/www\.novarock\.at\/artist\//.test(n.attrs.href ?? "")).length !== 44 ||
      new Set(cards.map((c) => c.caption.toLowerCase())).size !== 44 || new Set(cards.map((c) => c.officialUrl)).size !== 44) fail("duplicate card");
  // Observed original position/day vector; totals alone cannot
  // detect a compensating swap between two artists. This is not provenance.
  const observedDays = "0910111210091112090909121109090910101010101010101010101011111111111111121212121212121212";
  if (cards.map((c) => c.day.slice(-2)).join("") !== observedDays) fail("ordered day mutation");
  const dayCounts = DAYS.map((day) => cards.filter((c) => c.day === day).length);
  if (!equal(dayCounts, [8, 14, 10, 12])) fail("day counts");
  const normalized = content.snapshot.candidate.normalized;
  if (!equal(cards.map((c) => c.caption), [...normalized.headliners, ...normalized.lineup])) fail("sealed bill disagreement");
  return { authority: "NONE" as const, status: "UNTRUSTED_DOCUMENT_VERIFIED_NON_AUTHORIZING" as const,
    candidateId: content.snapshot.candidate.id, attemptId: content.snapshot.attempt.id, contentDigest: content.contentDigest,
    sourceId: readAcquisitionProvenance(content.snapshot.attempt.acquisitionProvenance)!.configuration.sourceId,
    rawDocumentSha256: createHash("sha256").update(raw).digest("hex"), rawDocumentBytes: raw.byteLength, cards, dayCounts,
    blockers: ["NO_TRUSTED_INDEPENDENT_NETWORK_PROVENANCE", "NO_DEPLOYED_EXTRACTOR_ATTESTATION"] as const };
}

const bindingSchema = z.object({ sealId: z.string().min(1).max(200), candidateId: z.string().min(1).max(200),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Read-only fresh replay, no observation INSERT. Source lock precedes lineage
 * locks. Historical attempts and source swap-away/back cannot be backfilled. */
export async function verifyNovaRockCardObservation(db: PrismaClient, binding: unknown, bytes: Uint8Array) {
  canonicalNovaContent(binding);
  const expected = bindingSchema.parse(binding);
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > NOVA_CARD_DOCUMENT_MAX_BYTES) fail("document byte bound");
  const raw = Uint8Array.from(bytes);
  return db.$transaction(async (tx) => {
    const seal = await tx.novaRockContentSeal.findUniqueOrThrow({ where: { id: expected.sealId } });
    const content = digestNovaRockContent(seal.snapshot).snapshot;
    const acquired = readAcquisitionProvenance(content.attempt.acquisitionProvenance)!;
    const config = acquired.configuration;
    await tx.$queryRaw`SELECT id FROM "FestivalSource" WHERE id = ${config.sourceId} FOR UPDATE`;
    const integrity = await verifyNovaRockContentSealInTransaction(tx, expected.sealId);
    if (integrity.candidateId !== expected.candidateId || integrity.contentDigest !== expected.contentDigest) fail("substituted seal binding");
    await tx.$queryRaw`SELECT id FROM "Festival" WHERE id = ${config.festivalId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FestivalEdition" WHERE id = ${config.editionId} FOR UPDATE`;
    const source = await tx.festivalSource.findUniqueOrThrow({ where: { id: config.sourceId }, include: { edition: true } });
    const festival = await tx.festival.findUniqueOrThrow({ where: { id: config.festivalId } });
    const candidate = await tx.ingestionCandidate.findUniqueOrThrow({ where: { id: expected.candidateId } });
    if (candidate.reviewState !== "PENDING" || festival.slug !== "nova-rock" || source.url !== URL ||
        source.requestHeaders !== null || config.requestHeaders !== null || source.leaseOwner !== null || source.leaseExpiresAt !== null ||
        !acquisitionMatchesSource(content.attempt.acquisitionProvenance, source) || source.edition?.recordState !== "CURRENT") fail("stale source or candidate");
    if (await tx.festivalSource.count({ where: { enabled: true, id: { not: source.id },
      OR: [{ editionId: config.editionId }, { festivalSlug: "nova-rock", editionYear: 2027 }] } })) fail("competing source");
    return { ...verifyNovaRockCardDocument(raw, content), sealId: seal.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
}
