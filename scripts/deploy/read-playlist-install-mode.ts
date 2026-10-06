import { pathToFileURL } from 'node:url';
import { playlistMode } from '../../lib/catalog/playlist-cutover.ts';
import type { PrismaClient } from '@prisma/client';

// Unlike the runtime default, a present null receipt is corruption, not legacy.
// An absent row is evidence only when combined with unambiguous timer state.
export async function readPlaylistInstallMode(db: Pick<PrismaClient, '$queryRaw'>): Promise<'absent' | 'database'> {
  const rows = await db.$queryRaw<{ payload: unknown }[]>`SELECT payload FROM "OperationalState" WHERE key = 'playlist-cutover'`;
  if (rows.length === 0) return 'absent';
  const value = rows[0].payload as Record<string, unknown> | null;
  if (rows.length !== 1 || !value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.commit !== 'string' || typeof value.queueHash !== 'string'
    || playlistMode(rows[0].payload) !== 'database') throw new Error('Invalid playlist activation record');
  return 'database';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.DATABASE_URL || process.argv.length !== 2) throw new Error();
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    let mode: 'absent' | 'database';
    try { mode = await readPlaylistInstallMode(db); }
    finally { await db.$disconnect(); }
    console.log(mode);
  } catch {
    console.error('Playlist installation proof unavailable or invalid');
    process.exitCode = 6;
  }
}
