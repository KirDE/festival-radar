import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../lib/db.ts';
import { readPlaylistMode } from '../lib/catalog/playlist-cutover.ts';
import { acquirePlaylistProcessLock } from '../lib/catalog/playlist-process-lock.ts';
const execute = promisify(execFile);
let release: (() => Promise<void>) | undefined;
try {
  // Only the internal route passes this to a child while holding the shared lock.
  if (process.env.PLAYLIST_LOCK_HELD !== 'true') release = await acquirePlaylistProcessLock();
  const mode = await readPlaylistMode(db);
  if (process.argv[3] === '--require-database' && mode !== 'database') throw new Error('DB playlist timer requires validated activation');
  const env = { ...process.env, PLAYLIST_LOCK_HELD: 'true' };
  if (mode === 'database') {
    await execute(process.execPath, ['--experimental-strip-types', 'scripts/playlist-worker.ts'], { env, timeout: 2_650_000, maxBuffer: 1024 * 1024 });
  } else {
    await execute('bash', ['scripts/deploy/run-legacy-playlists.sh', process.argv[2] ?? ''], { env, timeout: 2_650_000, maxBuffer: 10 * 1024 * 1024 });
  }
} catch { console.error('playlist_dispatch_failed'); process.exitCode = 1; }
finally { await release?.(); await db.$disconnect(); }
