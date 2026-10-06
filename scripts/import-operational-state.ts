import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db } from '../lib/db.ts';
const key = process.argv.find(arg => arg.startsWith('--key='))?.slice(6);
const input = process.argv.find(arg => arg.startsWith('--input='))?.slice(8);
const expectedHash = process.argv.find(arg => arg.startsWith('--expected-hash='))?.slice(16);
const apply = process.argv.includes('--apply');
if (!input || !['artist-identities', 'artist-enrichment'].includes(key ?? '') || !process.env.DATABASE_URL) throw new Error('DATABASE_URL, --key and --input required');
const bytes = await readFile(input);
if (bytes.length > 16 * 1024 * 1024) throw new Error('Operational inventory too large');
const payload = JSON.parse(bytes.toString('utf8'));
if (!payload || payload.schemaVersion !== 1 || (key === 'artist-identities' && (!payload.artists || typeof payload.artists !== 'object' || Array.isArray(payload.artists)))) throw new Error('Invalid operational inventory');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const digest = hash(payload);
if (apply && expectedHash !== digest) throw new Error('Apply requires exact preview --expected-hash');
try {
  const report = await db.$transaction(async tx => {
    if (apply) await tx.$executeRaw`INSERT INTO "OperationalState" (key, payload) VALUES (${key}, '{}'::jsonb) ON CONFLICT (key) DO NOTHING`;
    const rows = apply
      ? await tx.$queryRaw<{ payload: unknown; leaseOwner: string | null }[]>`SELECT payload, "leaseOwner" FROM "OperationalState" WHERE key = ${key} FOR UPDATE`
      : await tx.$queryRaw<{ payload: unknown; leaseOwner: string | null }[]>`SELECT payload, "leaseOwner" FROM "OperationalState" WHERE key = ${key}`;
    const row = rows[0];
    if (row?.leaseOwner) throw new Error('Drain operational worker before import');
    const empty = !row || JSON.stringify(row.payload) === '{}';
    if (!empty && hash(row.payload) !== digest) throw new Error('Existing DB progress differs; import never overwrites it');
    if (apply && empty) await tx.$executeRaw`UPDATE "OperationalState" SET payload = ${JSON.stringify(payload)}::jsonb, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE key = ${key}`;
    return { mode: apply ? 'apply' : 'preview', changed: empty ? 1 : 0, hash: digest, records: key === 'artist-identities' ? Object.keys(payload.artists).length : Object.keys(payload.profiles ?? {}).length };
  }, { isolationLevel: 'Serializable' });
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
