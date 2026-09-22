import {
  ArtistIdentityState,
  EditionCompleteness,
  EditionRecordState,
  FestivalStatus,
  LineupBilling,
  LineupEntryStatus,
  Prisma,
  PrismaClient,
  TicketStatus,
} from "@prisma/client";
import type { CatalogSeed } from "./seed.ts";

type Database = PrismaClient | Prisma.TransactionClient;

const festivalStatus = {
  confirmed: FestivalStatus.CONFIRMED,
  partial: FestivalStatus.PARTIAL,
  tba: FestivalStatus.TBA,
} as const;
const ticketStatus = {
  available: TicketStatus.AVAILABLE,
  low: TicketStatus.LOW,
  unavailable: TicketStatus.UNAVAILABLE,
  unknown: TicketStatus.UNKNOWN,
} as const;
const recordState = {
  archived: EditionRecordState.ARCHIVED,
  current: EditionRecordState.CURRENT,
  tracking: EditionRecordState.TRACKING,
} as const;
const completeness = {
  complete: EditionCompleteness.COMPLETE,
  partial: EditionCompleteness.PARTIAL,
  tba: EditionCompleteness.TBA,
} as const;
const identityState = {
  linked: ArtistIdentityState.LINKED,
  ambiguous: ArtistIdentityState.AMBIGUOUS,
  unresolved: ArtistIdentityState.UNRESOLVED,
  retryable: ArtistIdentityState.RETRYABLE,
} as const;

function dateOnly(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function instant(value?: string) {
  return value ? new Date(value) : null;
}

function assertUnique(values: readonly string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export function validateCatalogSeed(seed: CatalogSeed) {
  assertUnique(seed.festivals.map(({ slug }) => slug), "festival slug");
  assertUnique(seed.artists.map(({ slug }) => slug), "artist slug");
  assertUnique(seed.editions.map(({ slug, editionYear }) => `${slug}:${editionYear}`), "festival edition");

  const artistNamesBySlug = new Map<string, string>();
  const identities = new Map<string, string>();
  for (const artist of seed.artists) {
    const previousName = artistNamesBySlug.get(artist.slug);
    if (previousName && previousName !== artist.name) {
      throw new Error(`Artist slug collision: ${artist.slug} (${previousName} / ${artist.name})`);
    }
    artistNamesBySlug.set(artist.slug, artist.name);
    for (const [provider, externalId] of Object.entries(artist.identities)) {
      if (!externalId) continue;
      const key = `${provider}:${externalId}`;
      const owner = identities.get(key);
      if (owner && owner !== artist.slug) throw new Error(`Artist identity collision: ${key} (${owner} / ${artist.slug})`);
      identities.set(key, artist.slug);
    }
  }

  for (const edition of seed.editions) {
    const entries = [...edition.headliners, ...edition.lineup];
    assertUnique(entries.map((name) => artistNamesBySlug.has(artistSlugForSeed(name)) ? artistSlugForSeed(name) : name), `lineup entry in ${edition.slug}:${edition.editionYear}`);
  }
}

function artistSlugForSeed(name: string) {
  return encodeURIComponent(name.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
}

async function assertNoDatabaseConflicts(db: Database, seed: CatalogSeed) {
  const [festivals, artists, identities] = await Promise.all([
    db.festival.findMany({ select: { slug: true, name: true } }),
    db.artist.findMany({ select: { slug: true, name: true } }),
    db.artistIdentity.findMany({ include: { artist: { select: { slug: true } } } }),
  ]);
  const expectedFestivals = new Map(seed.festivals.map((item) => [item.slug, item.name]));
  const expectedArtists = new Map(seed.artists.map((item) => [item.slug, item.name]));
  for (const row of festivals) {
    const expected = expectedFestivals.get(row.slug);
    if (expected && expected !== row.name) throw new Error(`Festival conflict for ${row.slug}: database=${row.name}, seed=${expected}`);
  }
  for (const row of artists) {
    const expected = expectedArtists.get(row.slug);
    if (expected && expected !== row.name) throw new Error(`Artist conflict for ${row.slug}: database=${row.name}, seed=${expected}`);
  }
  const expectedIdentityOwners = new Map<string, string>();
  for (const artist of seed.artists) {
    for (const [provider, externalId] of Object.entries(artist.identities)) {
      if (externalId) expectedIdentityOwners.set(`${provider}:${externalId}`, artist.slug);
    }
  }
  for (const row of identities) {
    const expectedOwner = expectedIdentityOwners.get(`${row.provider}:${row.externalId}`);
    if (expectedOwner && expectedOwner !== row.artist.slug) {
      throw new Error(`Identity conflict for ${row.provider}:${row.externalId}: database=${row.artist.slug}, seed=${expectedOwner}`);
    }
  }
}

export async function backfillCatalog(client: PrismaClient, seed: CatalogSeed) {
  validateCatalogSeed(seed);

  await client.$transaction(async (db) => {
    await assertNoDatabaseConflicts(db, seed);
    const festivalIds = new Map<string, string>();
    for (const [catalogOrder, item] of seed.festivals.entries()) {
      const row = await db.festival.upsert({
        where: { slug: item.slug },
        create: {
          slug: item.slug,
          name: item.name,
          country: item.country,
          countryCode: item.countryCode,
          city: item.city,
          officialUrl: item.officialUrl,
          latitude: item.coordinates?.latitude,
          longitude: item.coordinates?.longitude,
          genres: item.genres,
          catalogOrder,
        },
        update: {
          name: item.name,
          country: item.country,
          countryCode: item.countryCode,
          city: item.city,
          officialUrl: item.officialUrl,
          latitude: item.coordinates?.latitude,
          longitude: item.coordinates?.longitude,
          genres: item.genres,
          catalogOrder,
        },
        select: { id: true },
      });
      festivalIds.set(item.slug, row.id);
    }

    const artistIds = new Map<string, string>();
    for (const item of seed.artists) {
      const row = await db.artist.upsert({
        where: { slug: item.slug },
        create: {
          slug: item.slug,
          name: item.name,
          aliases: item.aliases,
          origin: item.origin,
          genres: item.genres,
          biography: item.biography,
          imageUrl: item.image?.url,
          imageAlt: item.image?.alt,
          imageWidth: item.image?.width,
          imageHeight: item.image?.height,
          identityState: identityState[item.identityState],
          topTracks: item.topTracks,
          recentSetlists: item.recentSetlists,
          freshness: item.freshness,
        },
        update: {
          name: item.name,
          aliases: item.aliases,
          origin: item.origin,
          genres: item.genres,
          biography: item.biography,
          imageUrl: item.image?.url,
          imageAlt: item.image?.alt,
          imageWidth: item.image?.width,
          imageHeight: item.image?.height,
          identityState: identityState[item.identityState],
          topTracks: item.topTracks,
          recentSetlists: item.recentSetlists,
          freshness: item.freshness,
        },
        select: { id: true },
      });
      artistIds.set(item.slug, row.id);
      await db.artistIdentity.deleteMany({ where: { artistId: row.id } });
      await db.artistLink.deleteMany({ where: { artistId: row.id } });
      await db.artistProvenance.deleteMany({ where: { artistId: row.id } });
      const identities = Object.entries(item.identities)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([provider, externalId], position) => ({ artistId: row.id, provider, externalId, position }));
      if (identities.length) await db.artistIdentity.createMany({ data: identities });
      if (item.links.length) await db.artistLink.createMany({ data: item.links.map((link, position) => ({ artistId: row.id, position, ...link })) });
      if (item.provenance.length) {
        await db.artistProvenance.createMany({
          data: item.provenance.map((source, position) => ({ ...source, artistId: row.id, position, checkedAt: new Date(`${source.checkedAt}T00:00:00.000Z`) })),
        });
      }
    }

    for (const item of seed.editions) {
      const festivalId = festivalIds.get(item.slug);
      if (!festivalId) throw new Error(`Edition references unknown festival: ${item.slug}`);
      const edition = await db.festivalEdition.upsert({
        where: { festivalId_year: { festivalId, year: item.editionYear } },
        create: {
          festivalId,
          year: item.editionYear,
          startDate: dateOnly(item.startDate),
          endDate: dateOnly(item.endDate),
          dateLabel: item.dateLabel,
          status: festivalStatus[item.status],
          ticketStatus: ticketStatus[item.ticketStatus],
          ticketsUrl: item.ticketsUrl,
          recordState: recordState[item.recordState],
          completeness: completeness[item.completeness],
          sourceUpdatedAt: new Date(item.updatedAt),
          snapshotAt: instant(item.snapshotAt),
        },
        update: {
          startDate: dateOnly(item.startDate),
          endDate: dateOnly(item.endDate),
          dateLabel: item.dateLabel,
          status: festivalStatus[item.status],
          ticketStatus: ticketStatus[item.ticketStatus],
          ticketsUrl: item.ticketsUrl,
          recordState: recordState[item.recordState],
          completeness: completeness[item.completeness],
          sourceUpdatedAt: new Date(item.updatedAt),
          snapshotAt: instant(item.snapshotAt),
        },
        select: { id: true },
      });
      await db.lineupEntry.deleteMany({ where: { editionId: edition.id } });
      await db.editionProvenance.deleteMany({ where: { editionId: edition.id } });
      await db.timetablePerformance.deleteMany({ where: { editionId: edition.id } });
      const lineup = [
        ...item.headliners.map((name, position) => ({ name, position, billing: LineupBilling.HEADLINER })),
        ...item.lineup.map((name, position) => ({ name, position, billing: LineupBilling.LINEUP })),
      ];
      if (lineup.length) {
        await db.lineupEntry.createMany({
          data: lineup.map(({ name, position, billing }) => {
            const artistId = artistIds.get(artistSlugForSeed(name));
            if (!artistId) throw new Error(`Lineup references unknown artist: ${name}`);
            return { editionId: edition.id, artistId, billing, position };
          }),
        });
      }
      if (item.provenance.length) {
        await db.editionProvenance.createMany({
          data: item.provenance.map((source) => ({ ...source, editionId: edition.id, checkedAt: new Date(source.checkedAt) })),
        });
      }
      if (item.timetable?.length) {
        await db.timetablePerformance.createMany({
          data: item.timetable.map((performance) => {
            const details = performance as typeof performance & Partial<{
              timeZone: string;
              status: "scheduled" | "cancelled";
              sourceUrl: string;
              observedAt: string;
            }>;
            return {
              editionId: edition.id,
              artistId: artistIds.get(artistSlugForSeed(performance.artist)),
              artistName: performance.artist,
              date: dateOnly(performance.date)!,
              stage: performance.stage,
              start: performance.start,
              timeZone: details.timeZone,
              status: details.status === "cancelled" ? LineupEntryStatus.CANCELLED : LineupEntryStatus.ANNOUNCED,
              sourceUrl: details.sourceUrl,
              observedAt: instant(details.observedAt),
            };
          }),
        });
      }

      const status = item.recordState === "current" ? seed.playlists[item.slug as keyof typeof seed.playlists] : undefined;
      if (status?.spotifyUrl) {
        await db.festivalPlaylist.upsert({
          where: { editionId_provider: { editionId: edition.id, provider: "spotify" } },
          create: { editionId: edition.id, provider: "spotify", url: status.spotifyUrl, artistCount: status.artists, trackCount: status.tracks, syncedAt: new Date(status.updatedAt) },
          update: { url: status.spotifyUrl, artistCount: status.artists, trackCount: status.tracks, syncedAt: new Date(status.updatedAt) },
        });
      }
    }

    for (const item of seed.sources) {
      const festivalId = festivalIds.get(item.festivalSlug);
      await db.festivalSource.upsert({
        where: { festivalSlug_url: { festivalSlug: item.festivalSlug, url: item.url } },
        create: {
          festivalSlug: item.festivalSlug,
          url: item.url,
          strategies: item.strategies,
          refreshPolicy: item.refreshPolicy,
          enabled: item.enabled,
          editionYear: item.editionYear,
          manualReviewReason: item.manualReviewReason,
          festivalId,
        },
        update: { festivalId, strategies: item.strategies, refreshPolicy: item.refreshPolicy, enabled: item.enabled, editionYear: item.editionYear, manualReviewReason: item.manualReviewReason },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });

  return verifyCatalogParity(client, seed);
}

export type CatalogParity = {
  ok: boolean;
  expected: Record<string, number>;
  actual: Record<string, number>;
  mismatches: string[];
};

function comparable(value: unknown) {
  return JSON.stringify(value);
}

function compareRecord(mismatches: string[], key: string, expected: unknown, actual: unknown) {
  if (comparable(expected) !== comparable(actual)) mismatches.push(`${key}: field mismatch`);
}

function dateString(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export async function verifyCatalogParity(db: PrismaClient, seed: CatalogSeed): Promise<CatalogParity> {
  validateCatalogSeed(seed);
  const [festivals, editions, artists, lineupEntries, sources, playlists] = await Promise.all([
    db.festival.count(),
    db.festivalEdition.count(),
    db.artist.count(),
    db.lineupEntry.count(),
    db.festivalSource.count(),
    db.festivalPlaylist.count(),
  ]);
  const expected = {
    festivals: seed.festivals.length,
    editions: seed.editions.length,
    artists: seed.artists.length,
    lineupEntries: seed.editions.reduce((count, item) => count + item.headliners.length + item.lineup.length, 0),
    sources: seed.sources.length,
    playlists: Object.values(seed.playlists).filter((item) => item.spotifyUrl).length,
  };
  const actual = { festivals, editions, artists, lineupEntries, sources, playlists };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => actual[key as keyof typeof actual] !== value)
    .map(([key, value]) => `${key}: expected ${value}, found ${actual[key as keyof typeof actual]}`);

  const [databaseFestivals, databaseEditions, databaseArtists, databaseSources, databasePlaylists] = await Promise.all([
    db.festival.findMany(),
    db.festivalEdition.findMany({
    include: {
      festival: { select: { slug: true } },
      lineup: { include: { artist: { select: { name: true } } }, orderBy: [{ billing: "asc" }, { position: "asc" }] },
    },
    }),
    db.artist.findMany({ include: { identities: { orderBy: { provider: "asc" } } } }),
    db.festivalSource.findMany(),
    db.festivalPlaylist.findMany({ include: { edition: { include: { festival: { select: { slug: true } } } } } }),
  ]);

  const festivalBySlug = new Map(databaseFestivals.map((item) => [item.slug, item]));
  for (const [catalogOrder, item] of seed.festivals.entries()) {
    const row = festivalBySlug.get(item.slug);
    if (!row) { mismatches.push(`${item.slug}: missing festival`); continue; }
    compareRecord(mismatches, `festival ${item.slug}`, {
      name: item.name,
      country: item.country,
      countryCode: item.countryCode,
      city: item.city ?? null,
      officialUrl: item.officialUrl,
      latitude: item.coordinates?.latitude ?? null,
      longitude: item.coordinates?.longitude ?? null,
      genres: [...item.genres],
      catalogOrder,
    }, {
      name: row.name,
      country: row.country,
      countryCode: row.countryCode,
      city: row.city,
      officialUrl: row.officialUrl,
      latitude: row.latitude,
      longitude: row.longitude,
      genres: row.genres,
      catalogOrder: row.catalogOrder,
    });
  }

  const editionByKey = new Map(databaseEditions.map((edition) => [`${edition.festival.slug}:${edition.year}`, edition]));
  for (const item of seed.editions) {
    const key = `${item.slug}:${item.editionYear}`;
    const row = editionByKey.get(key);
    if (!row) { mismatches.push(`${key}: missing edition`); continue; }
    const headliners = row.lineup.filter(({ billing }) => billing === LineupBilling.HEADLINER).map(({ artist }) => artist.name);
    const lineup = row.lineup.filter(({ billing }) => billing === LineupBilling.LINEUP).map(({ artist }) => artist.name);
    if (JSON.stringify(headliners) !== JSON.stringify([...item.headliners])) mismatches.push(`${key}: headliners differ`);
    if (JSON.stringify(lineup) !== JSON.stringify([...item.lineup])) mismatches.push(`${key}: lineup differs`);
    compareRecord(mismatches, `edition ${key}`, {
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      dateLabel: item.dateLabel ?? null,
      status: festivalStatus[item.status],
      ticketStatus: ticketStatus[item.ticketStatus],
      ticketsUrl: item.ticketsUrl ?? null,
      recordState: recordState[item.recordState],
      completeness: completeness[item.completeness],
      sourceUpdatedAt: new Date(item.updatedAt).toISOString(),
      snapshotAt: instant(item.snapshotAt)?.toISOString() ?? null,
    }, {
      startDate: dateString(row.startDate),
      endDate: dateString(row.endDate),
      dateLabel: row.dateLabel,
      status: row.status,
      ticketStatus: row.ticketStatus,
      ticketsUrl: row.ticketsUrl,
      recordState: row.recordState,
      completeness: row.completeness,
      sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
      snapshotAt: row.snapshotAt?.toISOString() ?? null,
    });
  }

  const artistBySlug = new Map(databaseArtists.map((item) => [item.slug, item]));
  for (const item of seed.artists) {
    const row = artistBySlug.get(item.slug);
    if (!row) { mismatches.push(`${item.slug}: missing artist`); continue; }
    compareRecord(mismatches, `artist ${item.slug}`, {
      name: item.name,
      aliases: [...item.aliases],
      origin: item.origin ?? null,
      genres: [...item.genres],
      biography: item.biography ?? null,
      image: item.image ?? null,
      identityState: identityState[item.identityState],
      topTracks: [...item.topTracks],
      identities: Object.entries(item.identities).filter(([, externalId]) => Boolean(externalId)).sort(([left], [right]) => left.localeCompare(right)),
    }, {
      name: row.name,
      aliases: row.aliases,
      origin: row.origin,
      genres: row.genres,
      biography: row.biography,
      image: row.imageUrl ? { url: row.imageUrl, alt: row.imageAlt, width: row.imageWidth, height: row.imageHeight } : null,
      identityState: row.identityState,
      topTracks: row.topTracks,
      identities: row.identities.map(({ provider, externalId }) => [provider, externalId]),
    });
  }

  const sourceByKey = new Map(databaseSources.map((item) => [`${item.festivalSlug}:${item.url}`, item]));
  for (const item of seed.sources) {
    const key = `${item.festivalSlug}:${item.url}`;
    const row = sourceByKey.get(key);
    if (!row) { mismatches.push(`${key}: missing source`); continue; }
    compareRecord(mismatches, `source ${key}`, {
      strategies: [...item.strategies],
      refreshPolicy: item.refreshPolicy,
      enabled: item.enabled,
      editionYear: item.editionYear,
      manualReviewReason: item.manualReviewReason ?? null,
    }, {
      strategies: row.strategies,
      refreshPolicy: row.refreshPolicy,
      enabled: row.enabled,
      editionYear: row.editionYear,
      manualReviewReason: row.manualReviewReason,
    });
  }

  const playlistBySlug = new Map(databasePlaylists.map((item) => [item.edition.festival.slug, item]));
  for (const [slug, item] of Object.entries(seed.playlists)) {
    if (!item.spotifyUrl) continue;
    const row = playlistBySlug.get(slug);
    if (!row) { mismatches.push(`${slug}: missing playlist`); continue; }
    compareRecord(mismatches, `playlist ${slug}`, {
      provider: "spotify",
      url: item.spotifyUrl,
      artistCount: item.artists,
      trackCount: item.tracks,
      syncedAt: new Date(item.updatedAt).toISOString(),
    }, {
      provider: row.provider,
      url: row.url,
      artistCount: row.artistCount,
      trackCount: row.trackCount,
      syncedAt: row.syncedAt?.toISOString() ?? null,
    });
  }
  return { ok: mismatches.length === 0, expected, actual, mismatches };
}
