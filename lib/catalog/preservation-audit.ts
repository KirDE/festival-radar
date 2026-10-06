import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

// Fixed catalogue allowlist, never credentials/account tables. No contents are printed.
export const preservationTables = ['Festival', 'FestivalEdition', 'Artist', 'ArtistIdentity', 'ArtistLink', 'ArtistProvenance', 'LineupEntry', 'EditionProvenance', 'TimetablePerformance', 'FestivalPlaylist', 'FestivalSource', 'AssetBlob', 'FestivalLogo'] as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export async function auditDatabasePreservation(db: PrismaClient) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const tables: Record<string, { count: number; sha256: string }> = {};
    for (const table of preservationTables) {
      const rows = await tx.$queryRawUnsafe<{ value: unknown }[]>(`SELECT row_to_json(record) AS value FROM "${table}" AS record`);
      const ordered = rows.map(row => canonical(row.value)).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
      tables[table] = { count: rows.length, sha256: hash(ordered) };
    }
    return { tables, hash: hash(tables) };
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
}
