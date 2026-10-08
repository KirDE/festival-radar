import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type Festival, type FestivalEdition, type LineupEntry } from "@prisma/client";
import { z } from "zod";
import { acquisitionMatchesSource, readAcquisitionProvenance } from "./provenance.ts";
import { canonicalNovaContent, digestNovaRockContent, verifyNovaRockContentSealInTransaction } from "./novarock-content-seal.ts";

export const NOVA_REVIEW_SOURCE_ID = "cmuaee22i00xy6ncnc5uf6xxk";
export const NOVA_REVIEW_EDITION_ID = "cmuaee1xc00tf6ncn76ea3pu2";
const id = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().min(1).max(100);
const billing = z.enum(["HEADLINER", "LINEUP"]);
const days = ["2027-06-09", "2027-06-10", "2027-06-11", "2027-06-12"] as const;
const headliners = ["Die Toten Hosen", "The Smashing Pumpkins", "Faith No More", "Die Ärzte"];
const cardSchema = z.object({
  caption: name, officialUrl: z.string().regex(/^https:\/\/www\.novarock\.at\/artist\/[a-z0-9-]+\/$/),
  day: z.enum(days), billing, position: z.number().int().nonnegative(), artistId: id,
  canonicalName: name, slug: id, aliases: z.array(name).max(100), matchedAlias: name.nullable(), artistRevision: digest,
}).strict();
const baselineEntry = z.object({ id, artistId: id, billing, position: z.number().int().nonnegative(),
  status: z.enum(["ANNOUNCED", "CANCELLED"]), artistRevision: digest }).strict();
const draftSchema = z.object({
  version: z.literal(1), sealId: id, candidateId: id, contentDigest: digest,
  proposedReviewerUserId: id, expiresAt: z.string().datetime(),
  scope: z.literal("CATALOGUE_ONLY_SPOTIFY_DEFERRED"),
  sourceId: z.literal(NOVA_REVIEW_SOURCE_ID), editionId: z.literal(NOVA_REVIEW_EDITION_ID), festivalId: id,
  configurationGeneration: z.number().int().positive(), leaseVersion: z.number().int().positive(),
  baseline: z.object({ revision: digest, startDate: z.literal("2027-06-10"), endDate: z.literal("2027-06-12"),
    status: z.literal("PARTIAL"), lineup: z.array(baselineEntry).length(3) }).strict(),
  target: z.object({ startDate: z.literal("2027-06-09"), endDate: z.literal("2027-06-12"), status: z.literal("PARTIAL") }).strict(),
  // These are unverified claims, not independently captured card evidence.
  cards: z.array(cardSchema).length(44),
}).strict();
export type NovaRockReviewDraft = z.infer<typeof draftSchema>;
const fold = (value: string) => value.normalize("NFC").toLowerCase();
export const novaRockDraftRevision = (value: unknown) => createHash("sha256").update(canonicalNovaContent(value)).digest("hex");
const equal = (a: unknown, b: unknown) => canonicalNovaContent(a) === canonicalNovaContent(b);
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
type ReviewArtist = Prisma.ArtistGetPayload<{ include: { identities: true; links: true; provenance: true } }>;

/** Shape/consistency checks only. Never labels caller-supplied cards as evidence. */
export function parseNovaRockReviewDraft(input: unknown): NovaRockReviewDraft {
  canonicalNovaContent(input);
  const draft = draftSchema.parse(input);
  if (new Set(draft.cards.map((c) => c.artistId)).size !== 44 ||
      new Set(draft.cards.map((c) => fold(c.caption))).size !== 44 ||
      new Set(draft.cards.map((c) => c.officialUrl)).size !== 44) throw new Error("Reused card identity, caption or URL");
  if (new Set(draft.cards.map((c) => c.day)).size !== 4) throw new Error("Missing official day claim");
  draft.cards.forEach((card, i) => {
    if (card.billing !== (i < 4 ? "HEADLINER" : "LINEUP") || card.position !== (i < 4 ? i : i - 4)) throw new Error("Unordered card billing/position");
    if (card.matchedAlias === null ? card.caption !== card.canonicalName :
        card.caption !== card.matchedAlias || !card.aliases.includes(card.matchedAlias)) throw new Error("Undeclared caption alias");
    if (new Set([card.canonicalName, ...card.aliases].map(fold)).size !== card.aliases.length + 1) throw new Error("Duplicate identity aliases");
  });
  if (!equal(draft.cards.slice(0, 4).map((c) => c.caption), headliners)) throw new Error("Unexpected headline bill");
  const entries = draft.baseline.lineup;
  if (new Set(entries.map((e) => e.id)).size !== 3 || new Set(entries.map((e) => e.artistId)).size !== 3 ||
      new Set(entries.map((e) => `${e.billing}:${e.position}`)).size !== 3) throw new Error("Duplicate baseline entry");
  return draft;
}

/** Pure snapshot helper; callers must supply complete persisted rows. Its hash is
 * a draft CAS expectation, not proof, authentication or independent evidence. */
export function novaRockDraftBaseline(festival: Festival, edition: FestivalEdition, lineup: LineupEntry[], artists: ReviewArtist[]) {
  const orderedLineup = [...lineup].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const orderedArtists = [...artists].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    revision: novaRockDraftRevision(json({ festival, edition, lineup: orderedLineup, artists: orderedArtists })),
    startDate: edition.startDate?.toISOString().slice(0, 10), endDate: edition.endDate?.toISOString().slice(0, 10), status: edition.status,
    lineup: orderedLineup.map((entry) => ({ id: entry.id, artistId: entry.artistId, billing: entry.billing, position: entry.position,
      status: entry.status, artistRevision: novaRockDraftRevision(json(artists.find((a) => a.id === entry.artistId))) })),
  };
}

/** Bounded persisted-read validation. No INSERT, UPDATE, route or authorization.
 * Proposed user ID eligibility is NOT authentication of the calling person.
 * A successful read remains blocked by absent independent card evidence. */
export async function validateNovaRockReviewDraft(db: PrismaClient, input: unknown) {
  const draft = parseNovaRockReviewDraft(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "FestivalSource" WHERE id = ${draft.sourceId} FOR UPDATE`;
    const integrity = await verifyNovaRockContentSealInTransaction(tx, draft.sealId);
    if (integrity.candidateId !== draft.candidateId || integrity.contentDigest !== draft.contentDigest) throw new Error("Substituted seal/candidate digest");
    const seal = await tx.novaRockContentSeal.findUniqueOrThrow({ where: { id: draft.sealId } });
    const content = digestNovaRockContent(seal.snapshot).snapshot;
    const candidate = await tx.ingestionCandidate.findUniqueOrThrow({ where: { id: draft.candidateId } });
    if (candidate.reviewState !== "PENDING") throw new Error("Draft requires original pending REVIEW candidate");
    await tx.$queryRaw`SELECT id FROM "Festival" WHERE id = ${draft.festivalId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "FestivalEdition" WHERE id = ${draft.editionId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "LineupEntry" WHERE "editionId" = ${draft.editionId} ORDER BY id LIMIT 4 FOR UPDATE`;
    const artistIds = [...new Set([...draft.cards.map((c) => c.artistId), ...draft.baseline.lineup.map((e) => e.artistId)])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Artist" WHERE id IN (${Prisma.join(artistIds)}) ORDER BY id FOR UPDATE`);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${draft.proposedReviewerUserId} FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const user = await tx.user.findUnique({ where: { id: draft.proposedReviewerUserId } });
    if (!user || user.role !== "ADMIN") throw new Error("Proposed reviewer is not a current DB ADMIN");
    const expires = new Date(draft.expiresAt).getTime();
    if (expires <= now.getTime() || expires > now.getTime() + 24 * 60 * 60 * 1000) throw new Error("Expired or unbounded draft lifetime");
    const source = await tx.festivalSource.findUniqueOrThrow({ where: { id: draft.sourceId }, include: { edition: true } });
    const festival = await tx.festival.findUniqueOrThrow({ where: { id: draft.festivalId } });
    const edition = await tx.festivalEdition.findUniqueOrThrow({ where: { id: draft.editionId } });
    const acquired = readAcquisitionProvenance(content.attempt.acquisitionProvenance);
    if (!acquired || acquired.configuration.sourceId !== draft.sourceId || acquired.configuration.editionId !== draft.editionId ||
        acquired.configuration.festivalId !== draft.festivalId || festival.slug !== "nova-rock" ||
        edition.festivalId !== festival.id || edition.year !== 2027 || edition.recordState !== "CURRENT" ||
        source.festivalId !== festival.id || source.editionId !== edition.id || !source.enabled ||
        source.configurationGeneration !== draft.configurationGeneration || source.leaseVersion !== draft.leaseVersion ||
        source.leaseOwner !== null || source.leaseExpiresAt !== null ||
        !acquisitionMatchesSource(content.attempt.acquisitionProvenance, source)) throw new Error("Stale, swapped or nonquiescent source/edition lease");
    const competing = await tx.festivalSource.count({ where: { id: { not: source.id }, enabled: true,
      OR: [{ editionId: edition.id }, { festivalSlug: "nova-rock", editionYear: 2027 }] } });
    if (competing) throw new Error("Competing enabled Nova source");
    const lineup = await tx.lineupEntry.findMany({ where: { editionId: edition.id }, orderBy: { id: "asc" }, take: 4 });
    if (lineup.length !== 3) throw new Error("Unexpected baseline lineup cardinality");
    // Full catalogue scan intentionally checks aliases too; filtered canonical lookup misses ambiguity.
    // Serializable predicate reads also fence concurrent additions/alias edits.
    const allArtists = await tx.artist.findMany({ take: 10001, orderBy: { id: "asc" }, include: { identities: { orderBy: { id: "asc" } },
      links: { orderBy: { id: "asc" } }, provenance: { orderBy: { id: "asc" } } } });
    if (allArtists.length > 10000) throw new Error("Catalogue identity scan exceeds draft bound");
    const baselineArtists = allArtists.filter((a) => lineup.some((e) => e.artistId === a.id));
    if (!equal(novaRockDraftBaseline(festival, edition, lineup, baselineArtists), draft.baseline)) throw new Error("Mutable catalogue baseline");
    const baselineNames = (role: string) => lineup.filter((e) => e.billing === role).sort((a, b) => a.position - b.position)
      .map((e) => baselineArtists.find((a) => a.id === e.artistId)?.name);
    if (!equal(baselineNames("HEADLINER"), ["Die Ärzte", "Motionless In White"]) || !equal(baselineNames("LINEUP"), ["TBS"]) ||
        lineup.some((e) => e.status !== "ANNOUNCED")) throw new Error("Unexpected Nova baseline bill");
    if (!equal(draft.cards.map((c) => c.caption), [...content.candidate.normalized.headliners, ...content.candidate.normalized.lineup])) throw new Error("Cards disagree with sealed ordered bill");
    for (const card of draft.cards) {
      const matches = allArtists.filter((a) => a.slug === card.slug || [a.name, ...a.aliases].some((n) => fold(n) === fold(card.caption)));
      const artist = allArtists.find((a) => a.id === card.artistId);
      if (!artist || matches.length !== 1 || matches[0].id !== artist.id || artist.name !== card.canonicalName ||
          artist.slug !== card.slug || !equal(artist.aliases, card.aliases) || novaRockDraftRevision(json(artist)) !== card.artistRevision ||
          artist.identityState === "AMBIGUOUS") throw new Error("Unknown, ambiguous or stale artist binding");
    }
    if (lineup.some((entry) => !draft.cards.some((c) => c.artistId === entry.artistId))) throw new Error("Baseline identity replaced");
    const [{ checkedAt }] = await tx.$queryRaw<{ checkedAt: Date }[]>`SELECT clock_timestamp() AS "checkedAt"`;
    if (expires <= checkedAt.getTime()) throw new Error("Expired draft at final validation");
    return { authority: "NONE" as const, status: "DRAFT_VALIDATED_NON_AUTHORIZING" as const,
      candidateId: draft.candidateId, sealId: draft.sealId, contentDigest: draft.contentDigest,
      draftDigest: novaRockDraftRevision(draft),
      blockers: ["NO_INDEPENDENT_CARD_EVIDENCE", "CALLER_NOT_AUTHENTICATED_BY_DRAFT_VALIDATOR"] as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
}
