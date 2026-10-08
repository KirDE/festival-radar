import { Prisma, type Artist, type PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { ACTIVATION, artistCollisionKey, artistSlug, FIELDS, PLAN, PLAN_HASH, PROVENANCE, PUBLICATION_KEY, REVIEWED_AT, REVIEW_EXPIRES_AT, URLS, validateNames } from "./rockharz-2027-plan.ts";

export class GuardRejected extends Error {}
function guard(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new GuardRejected(reason);
}
const json = (value: unknown) => value as Prisma.InputJsonValue;
const date = (value: Date | null) => value?.toISOString().slice(0, 10);
const actorLabel = "github-actions:production:rockharz-2027-update";
const sourceReason = "Manual review only: all 29 /bands HTML tile titles verified by independent host read-only curl on 2026-10-08. Article/tile identity spelling ambiguities remain omitted; review canonical existing identities and spelling differences, separate Amon Amarth headline, dates and sold-out evidence weekly and after new announcements.";
type Tx = Prisma.TransactionClient;

async function target(tx: Tx) {
  const festivals = await tx.festival.findMany({ where: { OR: [
    { slug: { equals: PLAN.slug, mode: "insensitive" } }, { name: { equals: PLAN.name, mode: "insensitive" } },
  ] }, take: 3, include: { editions: { where: { OR: [{ year: 2027 }, { recordState: "CURRENT" }] }, take: 3 } } });
  guard(festivals.length === 1, "Festival identity is missing or ambiguous");
  const festival = festivals[0];
  guard(festival.slug === PLAN.slug && festival.name === PLAN.name && festival.countryCode === "DE"
    && ["https://www.rockharz-festival.com", "https://www.rockharz-festival.com/"].includes(festival.officialUrl), "Festival identity differs");
  guard(festival.editions.length === 1, "Expected one 2027 edition and one CURRENT edition");
  const edition = festival.editions[0];
  guard(edition.year === 2027 && edition.recordState === "CURRENT"
    && date(edition.startDate) === PLAN.startDate && date(edition.endDate) === PLAN.endDate, "Edition identity or dates differ");
  return { festival, edition };
}

async function sources(tx: Tx, festivalId: string, editionId: string) {
  // Include malformed bindings; don't hide a conflict behind a null FK or wrong year.
  return tx.festivalSource.findMany({ where: { OR: [
    { editionId }, { festivalSlug: { equals: PLAN.slug, mode: "insensitive" }, editionYear: 2027 },
    { festivalId, editionYear: 2027 },
  ] }, take: 6 });
}

async function pristine(tx: Tx) {
  const { festival, edition } = await target(tx);
  guard(edition.status === "TBA" && edition.completeness === "TBA" && edition.ticketStatus === "UNKNOWN", "Expected TBA/TBA/UNKNOWN baseline");
  guard(festival.city === null || festival.city === PLAN.city, "Existing city conflicts");
  guard(edition.ticketsUrl === null || edition.ticketsUrl === URLS.tickets, "Existing ticket URL conflicts");
  guard(await tx.lineupEntry.count({ where: { editionId: edition.id } }) === 0, "Lineup must be entirely EMPTY");
  guard(await tx.editionProvenance.count({ where: { editionId: edition.id } }) === 0, "Existing provenance requires review");
  guard((await sources(tx, festival.id, edition.id)).length === 0, "Existing 2027 sources require review");
  guard(await tx.timetablePerformance.count({ where: { editionId: edition.id } }) === 0, "Existing timetable conflicts");
  guard(await tx.festivalPlaylist.count({ where: { editionId: edition.id } }) === 0, "Existing edition playlist conflicts");
  guard(await tx.catalogPlaylistRefresh.count({ where: { festivalSlug: PLAN.slug } }) === 0, "Existing playlist jobs conflict");
  guard(await tx.catalogPublication.count({ where: { OR: [{ sourceId: PUBLICATION_KEY }, { festivalSlug: PLAN.slug, editionYear: 2027 }] } }) === 0, "Update already applied or publication conflicts");
  guard(await tx.adminDraft.count({ where: { resourceKind: "FESTIVAL", resourceKey: PLAN.slug, status: { in: ["DRAFT", "QUEUED"] } } }) === 0, "Pending admin draft conflicts");
  guard(await tx.adminChange.count({ where: { resourceKind: "FESTIVAL", resourceKey: PLAN.slug, status: "PENDING" } }) === 0, "Pending admin change conflicts");
  guard(await tx.ingestionCandidate.count({ where: { festivalSlug: PLAN.slug, OR: [{ sourceYear: 2027 }, { sourceYear: null }], reviewState: { in: ["PENDING", "APPROVED", "PUBLISHED"] } } }) === 0, "Ingestion candidate requires review");
  return { festival, edition };
}

type IdentityRow = Pick<Artist, "id" | "name" | "slug" | "aliases" | "identityState">;
export const ARTIST_READ_LIMIT = 20_000;
export function resolveArtistIdentities(rows: readonly IdentityRow[], names: readonly string[]) {
  guard(rows.length <= ARTIST_READ_LIMIT, "Artist catalog exceeds bounded identity review limit");
  validateNames(names);
  const keys = names.map((name) => new Set([artistCollisionKey(name), ...PLAN.tileSpellingDifferences
    .filter((difference) => difference.articleName.toLowerCase() === name.toLowerCase()).map((difference) => artistCollisionKey(difference.tileTitle))]));
  const wantedKeys = new Set(keys.flatMap((set) => [...set]));
  const wantedSlugs = new Set(names.map(artistSlug));
  const byKey = new Map<string, Map<string, IdentityRow>>();
  const bySlug = new Map<string, Map<string, IdentityRow>>();
  const index = (map: typeof byKey, key: string, row: IdentityRow) => {
    const matches = map.get(key) ?? new Map<string, IdentityRow>();
    matches.set(row.id, row);
    map.set(key, matches);
  };
  // One linear pass over one bounded, narrow catalog read, rather than one
  // table scan per artist/alias. Unicode folding needs no DB extension changes.
  for (const row of rows) {
    for (const spelling of [row.name, ...row.aliases]) {
      const key = artistCollisionKey(spelling);
      if (wantedKeys.has(key)) index(byKey, key, row);
    }
    const slug = row.slug.toLowerCase();
    if (wantedSlugs.has(slug)) index(bySlug, slug, row);
  }
  const resolved: { id: string | null; name: string; slug: string }[] = [];
  for (const [position, name] of names.entries()) {
    const slug = artistSlug(name);
    const matches = new Map(bySlug.get(slug));
    for (const key of keys[position]) for (const [id, row] of byKey.get(key) ?? []) matches.set(id, row);
    guard(matches.size <= 1, "Folded artist name/alias ambiguity or slug collision requires review");
    const match = matches.values().next().value;
    guard(!match || (match.name.toLowerCase() === name.toLowerCase() && match.identityState !== "AMBIGUOUS"), "Artist identity or slug collision requires review");
    guard(match || !PLAN.tileSpellingDifferences.some((difference) => difference.articleName.toLowerCase() === name.toLowerCase()), "Article/tile spelling difference requires an existing exact identity");
    resolved.push({ id: match?.id ?? null, name, slug: match?.slug ?? slug });
  }
  guard(new Set(resolved.filter((a) => a.id).map((a) => a.id)).size === resolved.filter((a) => a.id).length, "Duplicate resolved artist identity");
  return resolved;
}

async function identities(tx: Tx) {
  const rows = await tx.artist.findMany({ take: ARTIST_READ_LIMIT + 1,
    select: { id: true, name: true, slug: true, aliases: true, identityState: true } });
  return resolveArtistIdentities(rows, [...PLAN.headliners, ...PLAN.lineup]);
}

export async function readBack(tx: Tx, expectedCommit: string) {
  const { festival, edition } = await target(tx);
  guard(festival.city === PLAN.city && edition.status === "PARTIAL" && edition.completeness === "PARTIAL"
    && edition.ticketStatus === "UNAVAILABLE" && edition.ticketsUrl === URLS.tickets, "Updated fields failed readback");
  const lineup = await tx.lineupEntry.findMany({ where: { editionId: edition.id }, take: 28, include: { artist: true }, orderBy: [{ billing: "asc" }, { position: "asc" }] });
  guard(lineup.length === PLAN.lineup.length + PLAN.headliners.length, "Lineup count failed readback");
  for (const billing of ["HEADLINER", "LINEUP"] as const) {
    const entries = lineup.filter((e) => e.billing === billing);
    const names = billing === "HEADLINER" ? PLAN.headliners : PLAN.lineup;
    guard(entries.length === names.length && entries.every((e, i) => e.status === "ANNOUNCED" && e.position === i && e.artist.name.toLowerCase() === names[i].toLowerCase()), "Lineup identity or billing failed readback");
  }
  const proofs = await tx.editionProvenance.findMany({ where: { editionId: edition.id }, take: 10 });
  guard(proofs.length === PROVENANCE.length && PROVENANCE.every((p) => proofs.filter((q) => q.field === p.field && q.url === p.url && q.note === p.note && q.checkedAt.getTime() === REVIEWED_AT.getTime()).length === 1), "Field provenance failed readback");
  const configured = await sources(tx, festival.id, edition.id);
  guard(configured.length === Object.keys(URLS).length && Object.values(URLS).every((url) => configured.filter((s) => s.url === url && s.festivalId === festival.id && s.editionId === edition.id && s.festivalSlug === PLAN.slug && s.editionYear === 2027 && s.enabled && s.strategies.length === 1 && s.strategies[0] === "manual_review" && s.parserKey === "manual_review" && s.refreshPolicy === "weekly" && s.cadenceSeconds === 604800 && s.manualReviewReason === sourceReason && s.configurationBackfilledAt !== null).length === 1), "Source configuration failed readback");
  const publication = await tx.catalogPublication.findUnique({ where: { sourceId: PUBLICATION_KEY }, include: { playlistRefresh: true } });
  const audits = await tx.adminAuditEntry.findMany({ where: { action: "ROCKHARZ_2027_GUARDED_UPDATE", resourceKey: PLAN.slug }, take: 2 });
  guard(publication && publication.source === "ADMIN" && publication.festivalSlug === PLAN.slug && publication.editionYear === 2027
    && publication.actorLabel === actorLabel
    && publication.lineupChanged && JSON.stringify(publication.fields) === JSON.stringify(FIELDS)
    && (publication.evidence as Prisma.JsonObject)?.planHash === PLAN_HASH
    && isDeepStrictEqual((publication.evidence as Prisma.JsonObject)?.plan, PLAN)
    && publication.playlistRefresh === null, "Publication failed readback");
  guard(audits.length === 1 && (audits[0].metadata as Prisma.JsonObject)?.publicationId === publication.id
    && audits[0].actorLabel === actorLabel && audits[0].resourceKind === "FESTIVAL"
    && (audits[0].metadata as Prisma.JsonObject)?.planHash === PLAN_HASH
    && (audits[0].metadata as Prisma.JsonObject)?.commit === expectedCommit
    && (audits[0].metadata as Prisma.JsonObject)?.playlistRefreshRequested === false
    && (audits[0].metadata as Prisma.JsonObject)?.playlistJobs === 0
    && isDeepStrictEqual(audits[0].afterValue, PLAN)
    && isDeepStrictEqual(audits[0].evidence, PROVENANCE), "Audit failed readback");
  guard(await tx.catalogPlaylistRefresh.count({ where: { festivalSlug: PLAN.slug } }) === 0
    && await tx.festivalPlaylist.count({ where: { editionId: edition.id } }) === 0
    && await tx.ingestionNotificationOutbox.count({ where: { publicationId: publication.id } }) === 0, "Playlist/outbox readback failed");
  return { status: "VERIFIED", operation: PLAN.operation, festivalSlug: PLAN.slug, editionYear: 2027,
    editionId: edition.id, planHash: PLAN_HASH, commit: expectedCommit, publicationId: publication.id,
    auditId: audits[0].id, announced: lineup.length, headliners: 1, lineup: PLAN.lineup.length,
    sources: configured.length, provenance: proofs.length, playlistJobs: 0, playlistRefreshRequested: false };
}

export async function guardedRockharzUpdate(db: PrismaClient, input: {
  operation: "inspect" | "activate" | "readback"; expectedCommit: string; planHash: string; runId: string; activation?: string;
}, now = new Date()) {
  guard(/^[a-f0-9]{40}$/.test(input.expectedCommit) && input.planHash === PLAN_HASH && /^\d+:\d+$/.test(input.runId), "Invalid reviewed request");
  guard(["inspect", "activate", "readback"].includes(input.operation), "Invalid operation");
  guard(input.operation !== "activate" || input.activation === ACTIVATION, "Exact activation required");
  guard(input.operation === "readback" || (now >= REVIEWED_AT && now < REVIEW_EXPIRES_AT), "Evidence review expired; re-review required");
  return db.$transaction(async (tx) => {
    if (input.operation === "readback") return readBack(tx, input.expectedCommit);
    const { festival, edition } = await pristine(tx);
    const artists = await identities(tx);
    if (input.operation === "inspect") return { status: "READY", operation: PLAN.operation, commit: input.expectedCommit,
      editionId: edition.id, planHash: PLAN_HASH, announced: artists.length, reusedArtists: artists.filter((a) => a.id).length,
      newArtists: artists.filter((a) => !a.id).length, playlistJobs: 0, plan: PLAN };

    for (const artist of artists) {
      if (!artist.id) artist.id = (await tx.artist.create({ data: { name: artist.name, slug: artist.slug,
        aliases: [], genres: [], identityState: "UNRESOLVED", topTracks: [], recentSetlists: [], freshness: {} } })).id;
    }
    await tx.lineupEntry.createMany({ data: artists.map((artist, i) => ({ editionId: edition.id, artistId: artist.id!,
      billing: i === 0 ? "HEADLINER" : "LINEUP", position: i === 0 ? 0 : i - 1, status: "ANNOUNCED" })) });
    await tx.festival.update({ where: { id: festival.id }, data: { city: PLAN.city } });
    await tx.festivalEdition.update({ where: { id: edition.id }, data: { status: "PARTIAL", completeness: "PARTIAL",
      ticketStatus: "UNAVAILABLE", ticketsUrl: URLS.tickets, sourceUpdatedAt: REVIEWED_AT } });
    await tx.editionProvenance.createMany({ data: PROVENANCE.map((p) => ({ ...p, editionId: edition.id, checkedAt: REVIEWED_AT })) });
    await tx.festivalSource.createMany({ data: Object.values(URLS).map((url) => ({ festivalId: festival.id,
      editionId: edition.id, festivalSlug: PLAN.slug, editionYear: 2027, url, strategies: ["manual_review"],
      parserKey: "manual_review", enabled: true, refreshPolicy: "weekly", cadenceSeconds: 604800,
      nextRunAt: new Date(now.getTime() + 604800000), manualReviewReason: sourceReason, configurationBackfilledAt: now })) });
    const publication = await tx.catalogPublication.create({ data: { source: "ADMIN", sourceId: PUBLICATION_KEY,
      festivalSlug: PLAN.slug, editionYear: 2027, actorLabel,
      fields: FIELDS, lineupChanged: true, evidence: json({ planHash: PLAN_HASH, plan: PLAN, provenance: PROVENANCE }) } });
    await tx.adminAuditEntry.create({ data: { actorLabel: publication.actorLabel, action: "ROCKHARZ_2027_GUARDED_UPDATE",
      resourceKind: "FESTIVAL", resourceKey: PLAN.slug,
      beforeValue: { festivalId: festival.id, editionId: edition.id, city: festival.city, status: edition.status,
        completeness: edition.completeness, ticketStatus: edition.ticketStatus, ticketsUrl: edition.ticketsUrl,
        startDate: date(edition.startDate)!, endDate: date(edition.endDate)!, recordState: edition.recordState, lineup: [] },
      afterValue: json(PLAN), evidence: json(PROVENANCE), metadata: { publicationId: publication.id,
        planHash: PLAN_HASH, commit: input.expectedCommit, runId: input.runId, playlistRefreshRequested: false, playlistJobs: 0 } } });
    // Verify all writes before commit. No generic publisher, queue or notification hook.
    return readBack(tx, input.expectedCommit);
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 20_000 });
}
