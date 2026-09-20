import type { PrismaClient } from "@prisma/client";
import { artistProfiles, type ArtistProfile } from "../../data/artists.ts";
import { festivalEditions, type FestivalEdition } from "../../data/editions.ts";
import { festivals, type Festival, type PlaylistStatus } from "../../data/festivals.ts";
import playlistStatusJson from "../../data/playlist-status.json" with { type: "json" };

export type CatalogSnapshot = Readonly<{
  festivals: Festival[];
  editions: readonly FestivalEdition[];
  artists: ArtistProfile[];
  playlists: Readonly<Record<string, PlaylistStatus>>;
}>;
export type CatalogReadMode = "files" | "database";
export interface CatalogRepository { read(): Promise<CatalogSnapshot>; }

const fileSnapshot: CatalogSnapshot = Object.freeze({
  festivals,
  editions: festivalEditions,
  artists: artistProfiles,
  playlists: playlistStatusJson as Record<string, PlaylistStatus>,
});

export class FileCatalogRepository implements CatalogRepository {
  async read() { return fileSnapshot; }
}

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10);
const instant = (value: Date | null) => value?.toISOString();
const lower = <T extends string>(value: T) => value.toLocaleLowerCase() as Lowercase<T>;

export class DatabaseCatalogRepository implements CatalogRepository {
  private readonly client: PrismaClient;

  constructor(client: PrismaClient) { this.client = client; }

  async read(): Promise<CatalogSnapshot> {
    const [editionRows, artistRows] = await Promise.all([
      this.client.festivalEdition.findMany({
        include: {
          festival: true,
          lineup: { include: { artist: true }, orderBy: [{ billing: "asc" }, { position: "asc" }] },
          provenance: { orderBy: [{ field: "asc" }, { checkedAt: "asc" }] },
          timetable: { orderBy: [{ date: "asc" }, { start: "asc" }, { stage: "asc" }] },
          playlists: { orderBy: { provider: "asc" } },
        },
        orderBy: [{ year: "asc" }, { festival: { catalogOrder: "asc" } }],
      }),
      this.client.artist.findMany({
        include: {
          identities: { orderBy: { position: "asc" } },
          links: { orderBy: { position: "asc" } },
          provenance: { orderBy: { position: "asc" } },
        },
        orderBy: { slug: "asc" },
      }),
    ]);
    if (!editionRows.length || !artistRows.length) throw new Error("database catalogue is empty or incomplete");

    const editions: FestivalEdition[] = editionRows.map((row) => {
      const headliners = row.lineup.filter(({ billing }) => billing === "HEADLINER").map(({ artist }) => artist.name);
      const lineup = row.lineup.filter(({ billing }) => billing === "LINEUP").map(({ artist }) => artist.name);
      return {
        slug: row.festival.slug, name: row.festival.name, country: row.festival.country,
        countryCode: row.festival.countryCode, city: row.festival.city ?? undefined,
        startDate: dateOnly(row.startDate), endDate: dateOnly(row.endDate), dateLabel: row.dateLabel ?? undefined,
        headliners, lineup, officialUrl: row.festival.officialUrl, ticketsUrl: row.ticketsUrl ?? undefined,
        status: lower(row.status), editionYear: row.year,
        ticketStatus: lower(row.ticketStatus), updatedAt: row.sourceUpdatedAt.toISOString(),
        genres: row.festival.genres,
        coordinates: row.festival.latitude === null || row.festival.longitude === null
          ? undefined : { latitude: row.festival.latitude, longitude: row.festival.longitude },
        timetable: row.timetable.length ? row.timetable.map((performance) => ({
          date: dateOnly(performance.date)!, stage: performance.stage, start: performance.start,
          artist: performance.artistName, timeZone: performance.timeZone ?? "UTC",
          status: performance.status === "CANCELLED" ? "cancelled" : "scheduled",
          sourceUrl: performance.sourceUrl ?? row.festival.officialUrl,
          observedAt: instant(performance.observedAt) ?? row.sourceUpdatedAt.toISOString(),
        })) : undefined,
        recordState: lower(row.recordState), completeness: lower(row.completeness),
        snapshotAt: instant(row.snapshotAt),
        provenance: row.provenance.map((source) => ({
          field: source.field as "edition" | "dates" | "lineup", url: source.url,
          checkedAt: source.checkedAt.toISOString(), note: source.note,
        })),
      };
    });
    const currentEditions = editions.filter(({ recordState }) => recordState === "current");
    const currentArtistNames = new Set(currentEditions.flatMap(({ headliners, lineup }) => [...headliners, ...lineup]));
    const festivalsFromDatabase: Festival[] = currentEditions.map((edition) => {
      const { recordState: _recordState, completeness: _completeness, snapshotAt: _snapshotAt, provenance: _provenance, ...festival } = edition;
      const row = editionRows.find(({ festival: item, year }) => item.slug === edition.slug && year === edition.editionYear)!;
      return {
        ...festival,
        headliners: [...festival.headliners],
        lineup: [...festival.lineup],
        timetable: row.timetable.length ? row.timetable.map((performance) => ({
          date: dateOnly(performance.date)!, stage: performance.stage, start: performance.start,
          artist: performance.artistName, timeZone: performance.timeZone ?? "UTC",
          status: performance.status === "CANCELLED" ? "cancelled" : "scheduled",
          sourceUrl: performance.sourceUrl ?? row.festival.officialUrl,
          observedAt: instant(performance.observedAt) ?? row.sourceUpdatedAt.toISOString(),
        })) : undefined,
      };
    });
    const artists: ArtistProfile[] = artistRows
      .filter((row) => currentArtistNames.has(row.name)).map((row) => ({
      name: row.name, slug: row.slug, aliases: row.aliases, origin: row.origin ?? undefined,
      genres: row.genres, biography: row.biography ?? undefined,
      image: row.imageUrl && row.imageAlt && row.imageWidth && row.imageHeight
        ? { url: row.imageUrl, alt: row.imageAlt, width: row.imageWidth, height: row.imageHeight } : undefined,
      identities: Object.fromEntries(row.identities.map(({ provider, externalId }) => [provider, externalId])) as ArtistProfile["identities"],
      identityState: lower(row.identityState),
      links: row.links.map(({ label, url, source, verified }) => ({
        label, url, source: source as ArtistProfile["links"][number]["source"], verified,
      })),
      topTracks: row.topTracks, recentSetlists: row.recentSetlists as ArtistProfile["recentSetlists"],
      provenance: row.provenance.map(({ field, source, url, checkedAt }) => ({
        field, source: source as ArtistProfile["provenance"][number]["source"], url,
        checkedAt: checkedAt.toISOString().slice(0, 10),
      })),
      freshness: row.freshness as ArtistProfile["freshness"],
    })).sort((left, right) => left.name.localeCompare(right.name));
    const playlists: Record<string, PlaylistStatus> = {};
    for (const row of editionRows.filter(({ recordState }) => recordState === "CURRENT")) {
      const spotify = row.playlists.find(({ provider }) => provider === "spotify");
      const youtube = row.playlists.find(({ provider }) => provider === "youtube_music");
      if (!spotify) continue;
      playlists[row.festival.slug] = {
        spotifyUrl: spotify.url, youtubeMusicUrl: youtube?.url,
        artists: spotify.artistCount ?? row.lineup.length, tracks: spotify.trackCount ?? 0,
        updatedAt: instant(spotify.syncedAt) ?? row.sourceUpdatedAt.toISOString(),
      };
    }
    return Object.freeze({ festivals: festivalsFromDatabase, editions, artists, playlists });
  }
}

export function catalogReadMode(environment: NodeJS.ProcessEnv = process.env): CatalogReadMode {
  const value = environment.CATALOG_READ_MODE ?? "files";
  if (value !== "files" && value !== "database") throw new Error(`Invalid CATALOG_READ_MODE: ${value}`);
  return value;
}

export async function readCatalog(options: {
  environment?: NodeJS.ProcessEnv; database?: PrismaClient; fileRepository?: CatalogRepository;
} = {}): Promise<CatalogSnapshot> {
  const environment = options.environment ?? process.env;
  const files = options.fileRepository ?? new FileCatalogRepository();
  if (catalogReadMode(environment) === "files") return files.read();
  try {
    const database = options.database ?? (await import("../db.ts")).db;
    return await new DatabaseCatalogRepository(database).read();
  } catch (error) {
    if (environment.CATALOG_DATABASE_FALLBACK_ENABLED !== "true") throw error;
    console.warn("Database catalogue read failed; using explicit file fallback.");
    return files.read();
  }
}

let catalogPromise: Promise<CatalogSnapshot> | undefined;
export function getCatalog() {
  catalogPromise ??= readCatalog();
  return catalogPromise;
}
