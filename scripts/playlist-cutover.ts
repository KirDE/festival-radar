import { readFile } from 'node:fs/promises';
import { db } from '../lib/db.ts';
import { acquirePlaylistProcessLock } from '../lib/catalog/playlist-process-lock.ts';
import { queueActivationAudit, type QueueInventory } from '../lib/catalog/playlist-cutover.ts';
const args = process.argv.slice(2);
const activate = args.includes('--activate');
const drained = args.includes('--confirm-legacy-drained');
const commit = args.find(arg => arg.startsWith('--commit='))?.slice(9);
const expected = args.find(arg => arg.startsWith('--expected-queue-hash='))?.slice(22);
if (!process.env.DATABASE_URL || (activate && (!drained || !commit || !/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{64}$/.test(expected ?? '')))) throw new Error('Activation requires --confirm-legacy-drained, --commit and exact preview --expected-queue-hash');
if (activate && (await readFile('DEPLOYED_COMMIT', 'utf8')).trim() !== commit) throw new Error('Exact deployed commit required');
const release = await acquirePlaylistProcessLock();
try {
  const report = await db.$transaction(async tx => {
    const rows = await tx.$queryRaw<QueueInventory[]>`SELECT id, "publicationId", "festivalSlug", status, attempts, "leaseOwner", "leaseExpiresAt", "retryAt" FROM "CatalogPlaylistRefresh" ORDER BY id FOR UPDATE`;
    const audit = queueActivationAudit(rows);
    if (activate) {
      if (!audit.reconciled || audit.hash !== expected) throw new Error('Queue reconciliation or exact preview hash missing');
      const payload = JSON.stringify({ version: 1, mode: 'database', reconciled: true, legacyDrained: true, commit, queueHash: audit.hash });
      await tx.$executeRaw`INSERT INTO "OperationalState" (key, payload) VALUES ('playlist-cutover', ${payload}::jsonb)
        ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')`;
    }
    return { operation: 'playlist-cutover', mode: activate ? 'activate' : 'preview', ...audit };
  }, { isolationLevel: 'Serializable' });
  console.log(JSON.stringify(report));
} finally { await release(); await db.$disconnect(); }
