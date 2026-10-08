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
// Unknown entities, declarations, scripts and malformed nesting are drift. This
// deliberately accepts a narrower document profile than a browser or the adapter.
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
  const voids = new Set(["meta", "link", "img", "source", "br", "hr", "input", "wbr"]);
  let cursor = 0, tokens = 0;
  const token = /<!--[^]*?-->|<\/?[a-z][\w:-]*(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*\/?\s*>/gi;
  for (const m of html.matchAll(token)) {
    if (++tokens > 30000 || stack.length > 64) fail("structural bound exceeded");
    const text = html.slice(cursor, m.index);
    if (text.includes("<")) fail("malformed document token");
    stack.at(-1)!.text += text;
    cursor = m.index! + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const tag = /^<\/?([\w:-]+)/.exec(m[0])![1].toLowerCase();
    if (m[0].startsWith("</")) {
      if (m[0].toLowerCase() !== `</${tag}>` || stack.length === 1 || stack.at(-1)!.tag !== tag) fail("unbalanced document");
      stack.pop(); continue;
    }
    if (["script", "style", "noscript", "template"].includes(tag)) fail("unsupported opaque markup");
    if (!voids.has(tag) && /\/\s*>$/.test(m[0])) fail("self-closing container");
    const attrs: Record<string, string> = {};
    for (const a of m[0].replace(/^<[\w:-]+/, "").matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      const key = a[1].toLowerCase();
      if (Object.hasOwn(attrs, key)) fail("duplicate attribute");
      attrs[key] = decode(a[2] ?? a[3] ?? "");
    }
    if (Object.keys(attrs).some((key) => ["hidden", "inert", "style"].includes(key)) ||
        attrs["aria-hidden"] !== undefined && attrs["aria-hidden"] !== "false") fail("hidden or styled markup");
    const node: Element = { tag, attrs, children: [], text: "" };
    stack.at(-1)!.children.push(node);
    if (!voids.has(tag)) stack.push(node);
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
  const canonical = head.children.filter((n) => n.tag === "link" && n.attrs.rel === "canonical");
  if (canonical.length !== 1 || canonical[0].attrs.href !== CANONICAL) fail("canonical identity");
  for (const [key, value] of Object.entries({ "og:url": CANONICAL, "og:title": "Nova Rock 2027", "og:type": "article" })) {
    const metas = head.children.filter((n) => n.tag === "meta" && (n.attrs.name === key || n.attrs.property === key));
    if (metas.length !== 1 || metas[0].attrs.content !== value) fail("OG identity");
  }
  shape(body, "body", 1);
  const main = body.children[0]; shape(main, "main", 2, "lineupArchive");
  const [header, section] = main.children;
  shape(header, "header", 1, "lineupArchive__header");
  const h1 = header.children[0];
  if (h1.tag !== "h1" || h1.children.length || decode(h1.text) !== "Line-Up 2027") fail("visible identity");
  shape(section, "section", 1, "lineupArchive__content");
  const grid = section.children[0]; shape(grid, "ul", 44, "eventCollection__items");
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
  if (nodes(doc).filter((n) => has(n, "artistCard")).length !== 44 ||
      new Set(cards.map((c) => c.caption.toLowerCase())).size !== 44 || new Set(cards.map((c) => c.officialUrl)).size !== 44) fail("duplicate card");
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
