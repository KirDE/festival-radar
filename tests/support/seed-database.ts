import { PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./disposable-db.ts";
import { seedCatalog } from "./seed-catalog.ts";
import { catalogSeed, festival, artist } from "./catalog.ts";
requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const fixtures = [festival,
  { ...festival, slug: "synthetic-alpine", name: "Synthetic Alpine", country: "Austria", countryCode: "AT", coordinates: { latitude: 47, longitude: 14 } },
  { ...festival, slug: "synthetic-west", name: "Synthetic West", country: "France", countryCode: "FR", coordinates: { latitude: 48, longitude: 2 } },
  { ...festival, slug: "synthetic-south", name: "Synthetic South", country: "Spain", countryCode: "ES", coordinates: { latitude: 40, longitude: -3 } },
];
try {
  // Remove historical data inserted by migrations and previous test runs.
  // The guard above restricts this reset to a local disposable database.
  await db.festivalSource.deleteMany();
  await db.festival.deleteMany();
  await db.artist.deleteMany();
  await seedCatalog(db, {
    ...catalogSeed, festivals: fixtures,
    artists: [artist, { ...artist, name: "Second Artist", slug: "second-artist" }],
    editions: fixtures.map(row => ({ ...row, editionYear: 2027, recordState: "current", completeness: "complete", provenance: [] })),
  });
} finally { await db.$disconnect(); }
