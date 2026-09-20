import {
  ArtistIdentityState,
  CatalogPublicationSource,
  FestivalStatus,
  LineupBilling,
  Prisma,
  TicketStatus,
  type PrismaClient,
} from "@prisma/client";
import type { IngestionResult } from "../ingestion/types.ts";

type Database = PrismaClient | Prisma.TransactionClient;
type CatalogChange = { field: string; before?: unknown; after?: unknown };

const festivalStatuses = { confirmed: FestivalStatus.CONFIRMED, partial: FestivalStatus.PARTIAL, tba: FestivalStatus.TBA } as const;
const ticketStatuses = { available: TicketStatus.AVAILABLE, low: TicketStatus.LOW, unavailable: TicketStatus.UNAVAILABLE, unknown: TicketStatus.UNKNOWN } as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const dateOnly = (value: unknown) => typeof value === "string" && value ? new Date(`${value}T00:00:00.000Z`) : null;
const isoDate = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function artistSlug(name: string) {
  return encodeURIComponent(name.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
}

function stringList(value: unknown, field: string) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|,/) : [];
  const cleaned = values.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (!cleaned.length && value !== "" && (!Array.isArray(value) || value.length)) throw new Error(`Invalid ${field} list`);
  const keys = cleaned.map((item) => item.toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error(`Ambiguous duplicate ${field} artist`);
  return cleaned;
}

async function ensureArtist(db: Database, name: string, observedAt: Date) {
  const slug = artistSlug(name);
  if (!slug) throw new Error(`Cannot derive artist slug for ${name}`);
  const bySlug = await db.artist.findUnique({ where: { slug } });
  if (bySlug && bySlug.name !== name) throw new Error(`Artist slug collision: ${slug} (${bySlug.name} / ${name})`);
  const byName = await db.artist.findMany({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, slug: true, name: true } });
  if (byName.length > 1 || (byName.length === 1 && byName[0].slug !== slug)) throw new Error(`Ambiguous artist identity for ${name}`);
  if (bySlug) return bySlug;
  const checkedAt = observedAt.toISOString().slice(0, 10);
  return db.artist.create({ data: {
    slug, name, aliases: [], genres: [], identityState: ArtistIdentityState.UNRESOLVED,
    topTracks: [], recentSetlists: json([]),
    freshness: json({
      profile: { checkedAt, cadenceDays: 90, refreshAfter: checkedAt },
      music: { checkedAt, cadenceDays: 14, refreshAfter: checkedAt },
      setlists: { checkedAt, cadenceDays: 7, refreshAfter: checkedAt },
    }),
  } });
}

async function replaceLineup(db: Database, editionId: string, billing: LineupBilling, names: string[], observedAt: Date) {
  const otherBilling = billing === LineupBilling.HEADLINER ? LineupBilling.LINEUP : LineupBilling.HEADLINER;
  const existing = await db.lineupEntry.findMany({ where: { editionId, billing }, include: { artist: true }, orderBy: { position: "asc" } });
  if (same(existing.map(({ artist }) => artist.name), names)) return false;
  const other = await db.lineupEntry.findMany({ where: { editionId, billing: otherBilling }, include: { artist: true } });
  const otherNames = new Set(other.map(({ artist }) => artist.name.toLocaleLowerCase()));
  if (names.some((name) => otherNames.has(name.toLocaleLowerCase()))) throw new Error("Artist cannot have ambiguous lineup billing");
  const artists = [];
  for (const name of names) artists.push(await ensureArtist(db, name, observedAt));
  await db.lineupEntry.deleteMany({ where: { editionId, billing } });
  if (artists.length) await db.lineupEntry.createMany({ data: artists.map((artist, position) => ({ editionId, artistId: artist.id, billing, position })) });
  return true;
}

async function addLineupArtist(db: Database, editionId: string, billing: LineupBilling, name: string, observedAt: Date) {
  const artist = await ensureArtist(db, name, observedAt);
  const existing = await db.lineupEntry.findUnique({ where: { editionId_artistId: { editionId, artistId: artist.id } } });
  if (existing) {
    if (existing.billing !== billing) throw new Error(`Ambiguous billing change for ${name}`);
    return false;
  }
  const last = await db.lineupEntry.aggregate({ where: { editionId, billing }, _max: { position: true } });
  await db.lineupEntry.create({ data: { editionId, artistId: artist.id, billing, position: (last._max.position ?? -1) + 1 } });
  return true;
}

async function applyFestivalChanges(db: Database, input: {
  festivalSlug: string;
  expectedYear?: number;
  changes: CatalogChange[];
  strictBefore: boolean;
  observedAt: Date;
}) {
  const festival = await db.festival.findUnique({ where: { slug: input.festivalSlug }, include: { editions: { where: { recordState: "CURRENT" } } } });
  if (!festival) throw new Error(`Unknown catalogue festival: ${input.festivalSlug}`);
  if (festival.editions.length !== 1) throw new Error(`Ambiguous current edition for ${input.festivalSlug}`);
  const edition = festival.editions[0];
  if (input.expectedYear !== undefined && edition.year !== input.expectedYear) throw new Error(`Candidate edition ${input.expectedYear} does not match catalogue edition ${edition.year}`);

  const changedFields: string[] = [];
  for (const change of input.changes) {
    let current: unknown;
    let changed = false;
    switch (change.field) {
      case "city":
      case "name":
      case "country":
      case "officialUrl": {
        current = festival[change.field];
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ${change.field} value for ${input.festivalSlug}`);
        if (!same(current, change.after)) {
          if (typeof change.after !== "string" || !change.after.trim()) throw new Error(`Invalid ${change.field}`);
          await db.festival.update({ where: { id: festival.id }, data: { [change.field]: change.after.trim() } });
          changed = true;
        }
        break;
      }
      case "startDate":
      case "endDate": {
        current = isoDate(edition[change.field]);
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ${change.field} value for ${input.festivalSlug}`);
        if (!same(current, change.after)) {
          await db.festivalEdition.update({ where: { id: edition.id }, data: { [change.field]: dateOnly(change.after), sourceUpdatedAt: input.observedAt } });
          changed = true;
        }
        break;
      }
      case "ticketsUrl": {
        current = edition.ticketsUrl;
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ticketsUrl value for ${input.festivalSlug}`);
        if (!same(current, change.after)) {
          if (change.after !== undefined && change.after !== null && typeof change.after !== "string") throw new Error("Invalid ticketsUrl");
          await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketsUrl: change.after as string | null | undefined, sourceUpdatedAt: input.observedAt } });
          changed = true;
        }
        break;
      }
      case "status": {
        current = edition.status.toLocaleLowerCase();
        const next = festivalStatuses[String(change.after).toLocaleLowerCase() as keyof typeof festivalStatuses];
        if (!next) throw new Error(`Invalid festival status: ${String(change.after)}`);
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale status value for ${input.festivalSlug}`);
        if (edition.status !== next) { await db.festivalEdition.update({ where: { id: edition.id }, data: { status: next, sourceUpdatedAt: input.observedAt } }); changed = true; }
        break;
      }
      case "ticketStatus": {
        current = edition.ticketStatus.toLocaleLowerCase();
        const next = ticketStatuses[String(change.after).toLocaleLowerCase() as keyof typeof ticketStatuses];
        if (!next) throw new Error(`Invalid ticket status: ${String(change.after)}`);
        if (input.strictBefore && !same(current, change.before) && !same(current, change.after)) throw new Error(`Stale ticketStatus value for ${input.festivalSlug}`);
        if (edition.ticketStatus !== next) { await db.festivalEdition.update({ where: { id: edition.id }, data: { ticketStatus: next, sourceUpdatedAt: input.observedAt } }); changed = true; }
        break;
      }
      case "lineup":
      case "headliners": {
        const billing = change.field === "headliners" ? LineupBilling.HEADLINER : LineupBilling.LINEUP;
        changed = Array.isArray(change.after) || (typeof change.after === "string" && /\r?\n|,/.test(change.after))
          ? await replaceLineup(db, edition.id, billing, stringList(change.after, change.field), input.observedAt)
          : await addLineupArtist(db, edition.id, billing, String(change.after), input.observedAt);
        break;
      }
      default:
        throw new Error(`Unsupported catalogue publication field: ${change.field}`);
    }
    if (changed) changedFields.push(change.field);
  }
  return { edition, changedFields: [...new Set(changedFields)] };
}

async function createPublication(db: Database, input: {
  source: CatalogPublicationSource;
  sourceId: string;
  festivalSlug: string;
  editionYear: number;
  actorLabel: string;
  fields: string[];
  evidence: unknown;
}) {
  if (!input.fields.length) return null;
  const lineupChanged = input.fields.some((field) => field === "lineup" || field === "headliners");
  const publication = await db.catalogPublication.create({ data: {
    source: input.source, sourceId: input.sourceId, festivalSlug: input.festivalSlug,
    editionYear: input.editionYear, actorLabel: input.actorLabel, fields: input.fields,
    lineupChanged, evidence: json(input.evidence),
  } });
  if (lineupChanged) await db.catalogPlaylistRefresh.create({ data: { publicationId: publication.id, festivalSlug: input.festivalSlug } });
  return { ...publication, playlistRefreshRequested: lineupChanged };
}

export async function publishIngestionResult(client: PrismaClient, input: { attemptId: string; result: IngestionResult; sourceCommit: string }) {
  if (!input.result.publishable || input.result.reviewReasons.length || input.result.changes.some(({ reviewRequired }) => reviewRequired)) throw new Error(`Refusing ambiguous ingestion publication for ${input.result.festivalSlug}`);
  return client.$transaction(async (db) => {
    const candidate = await db.ingestionCandidate.findUnique({ where: { attemptId: input.attemptId }, include: { diffs: true, evidence: true } });
    if (!candidate || !candidate.publishable) throw new Error("Publishable ingestion candidate was not persisted");
    const sourceId = `ingestion:${candidate.id}`;
    const existing = await db.catalogPublication.findUnique({ where: { sourceId } });
    if (existing) return { ...existing, playlistRefreshRequested: existing.lineupChanged };
    if (candidate.reviewState !== "PENDING") throw new Error(`Candidate is not pending: ${candidate.reviewState}`);
    if (candidate.diffs.some(({ reviewRequired }) => reviewRequired)) throw new Error("Persisted candidate requires review");
    const normalizedDiffs = (values: { field: string; before: unknown; after: unknown }[]) => values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const expected = normalizedDiffs(input.result.changes.map(({ field, before, after }) => ({ field, before: before ?? null, after: after ?? null })));
    const persisted = normalizedDiffs(candidate.diffs.map(({ field, beforeValue, afterValue }) => ({ field, before: beforeValue, after: afterValue })));
    if (!same(expected, persisted)) throw new Error("Persisted ingestion diff does not match publication request");
    const expectedYear = input.result.candidate.observedEditionYears.length === 1 ? input.result.candidate.observedEditionYears[0] : candidate.sourceYear ?? undefined;
    if (!expectedYear && input.result.changes.some(({ field }) => field === "lineup" || field === "headliners")) throw new Error("Cannot publish a lineup without one verified edition year");
    const applied = await applyFestivalChanges(db, { festivalSlug: input.result.festivalSlug, expectedYear, changes: input.result.changes, strictBefore: true, observedAt: new Date(input.result.fetchedAt) });
    const publication = await createPublication(db, {
      source: CatalogPublicationSource.INGESTION, sourceId, festivalSlug: input.result.festivalSlug,
      editionYear: applied.edition.year, actorLabel: "automatic-ingestion", fields: applied.changedFields,
      evidence: { candidateId: candidate.id, sourceCommit: input.sourceCommit, sourceUrl: input.result.sourceUrl, evidenceIds: candidate.evidence.map(({ id }) => id) },
    });
    await db.ingestionCandidate.update({ where: { id: candidate.id }, data: {
      reviewState: publication ? "PUBLISHED" : "SUPERSEDED", reviewActor: "automatic-ingestion",
      reviewedAt: new Date(), publishedAt: publication ? new Date() : null, catalogueVersion: publication?.id ?? null,
    } });
    return publication;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

export async function publishAdminFestivalChange(db: Prisma.TransactionClient, input: {
  change: { id: string; resourceKey: string; field: string; beforeValue: unknown; afterValue: unknown; sourceEvidence: unknown; parserRunId: string | null };
  actorLabel: string;
}) {
  const sourceId = `admin:${input.change.id}`;
  const existing = await db.catalogPublication.findUnique({ where: { sourceId } });
  if (existing) return { ...existing, playlistRefreshRequested: existing.lineupChanged };
  const afterValue = input.change.field === "lineup" || input.change.field === "headliners"
    ? stringList(input.change.afterValue, input.change.field)
    : input.change.afterValue;
  const applied = await applyFestivalChanges(db, {
    festivalSlug: input.change.resourceKey,
    changes: [{ field: input.change.field, before: input.change.beforeValue, after: afterValue }],
    strictBefore: Boolean(input.change.parserRunId), observedAt: new Date(),
  });
  return createPublication(db, {
    source: CatalogPublicationSource.ADMIN, sourceId, festivalSlug: input.change.resourceKey,
    editionYear: applied.edition.year, actorLabel: input.actorLabel, fields: applied.changedFields,
    evidence: { adminChangeId: input.change.id, sourceEvidence: input.change.sourceEvidence },
  });
}
