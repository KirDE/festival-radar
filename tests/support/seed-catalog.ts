import { Prisma, type PrismaClient } from "@prisma/client";
import type { CatalogSeed } from "./catalog.ts";
import { requireLocalDisposableDatabase } from "./disposable-db.ts";

/** Provision only synthetic rows in a disposable DB; never shipped in releases. */
export async function seedCatalog(client: PrismaClient, fixture: CatalogSeed) {
  requireLocalDisposableDatabase(process.env.DATABASE_URL);
  await client.$transaction(async db => {
    const artistIds = new Map<string, string>();
    for (const artist of fixture.artists) {
      const data = {
        name: artist.name, aliases: artist.aliases, genres: artist.genres, biography: artist.biography,
        identityState: "UNRESOLVED" as const, topTracks: artist.topTracks,
        recentSetlists: artist.recentSetlists, freshness: artist.freshness,
      };
      const row = await db.artist.upsert({ where: { slug: artist.slug }, create: { slug: artist.slug, ...data }, update: data });
      artistIds.set(artist.name, row.id);
    }
    for (const [catalogOrder, festival] of fixture.festivals.entries()) {
      const data = {
        name: festival.name, country: festival.country, countryCode: festival.countryCode,
        city: festival.city, officialUrl: festival.officialUrl, genres: festival.genres, catalogOrder,
        latitude: festival.coordinates?.latitude, longitude: festival.coordinates?.longitude,
      };
      const stored = await db.festival.upsert({ where: { slug: festival.slug }, create: { slug: festival.slug, ...data }, update: data });
      for (const edition of fixture.editions.filter(row => row.slug === festival.slug)) {
        const data = {
          startDate: edition.startDate ? new Date(edition.startDate) : null,
          endDate: edition.endDate ? new Date(edition.endDate) : null,
          status: "CONFIRMED" as const, ticketStatus: "UNKNOWN" as const,
          recordState: edition.recordState === "archived" ? "ARCHIVED" as const : "CURRENT" as const,
          completeness: "COMPLETE" as const, sourceUpdatedAt: new Date(edition.updatedAt),
          snapshotAt: edition.snapshotAt ? new Date(edition.snapshotAt) : null,
        };
        const row = await db.festivalEdition.upsert({ where: { festivalId_year: { festivalId: stored.id, year: edition.editionYear } }, create: { festivalId: stored.id, year: edition.editionYear, ...data }, update: data });
        await db.lineupEntry.deleteMany({ where: { editionId: row.id } });
        for (const [billing, names] of [["HEADLINER", edition.headliners], ["LINEUP", edition.lineup]] as const) {
          for (const [position, name] of names.entries()) {
            const artistId = artistIds.get(name);
            if (!artistId) throw new Error("Unknown synthetic artist");
            await db.lineupEntry.create({ data: { editionId: row.id, artistId, billing, position } });
          }
        }
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
