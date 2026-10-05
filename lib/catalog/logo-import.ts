import { createHash } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import type { Prisma, PrismaClient } from '@prisma/client';
import { festivalLogoFallbacks, festivalLogoPath } from '../../data/festival-logos.ts';
import { festivals } from '../../data/festivals.ts';
import { MAX_LOGO_BYTES, validateLogo, type LogoMimeType } from './logo-assets.ts';
import inventory from '../../data/reviewed-logo-inventory.json' with { type: 'json' };

export type ReviewedLogo = { slug: string; file: string; mimeType: LogoMimeType; sizeBytes: number; sha256: string; bytes: Buffer };
export const LOGO_DIRECTORY = fileURLToPath(new URL('../../source-inputs/reviewed-logos/', import.meta.url));
const TYPES: Record<string, LogoMimeType> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXPECTED_COUNT = 47;
export const PINNED_REVIEWED_DIGEST = '99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456';

/** Decode every pixel; metadata and signatures alone cannot reject truncated payloads. */
export async function decodeReviewedLogo(bytes: Buffer, expectedMime: LogoMimeType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_LOGO_BYTES) throw new Error('Logo size outside permitted range');
  const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, sequentialRead: false });
  const metadata = await decoder.metadata();
  if (!metadata.format || TYPES[metadata.format] !== expectedMime || !metadata.width || !metadata.height) {
    throw new Error('Logo MIME mismatch or invalid dimensions');
  }
  await decoder.clone().raw().toBuffer();
  return validateLogo(bytes, expectedMime);
}

/** Pinned reviewed inventory: reject missing, extra, substituted, or unbound files. */
export async function auditReviewedLogos(directory = LOGO_DIRECTORY): Promise<ReviewedLogo[]> {
  const expected = inventory as { slug: string; file: string; mimeType: LogoMimeType; sizeBytes: number; sha256: string }[];
  const names = (await readdir(directory)).sort();
  const listed = expected.map(row => row.file).sort();
  if (expected.length !== EXPECTED_COUNT || JSON.stringify(names) !== JSON.stringify(listed) || new Set(listed).size !== expected.length) {
    throw new Error('Reviewed logo inventory differs from filesystem');
  }
  const sourceSlugs = new Set(festivals.map(f => f.slug));
  const logoSlugs = new Set(expected.map(row => row.slug));
  if (sourceSlugs.size !== festivals.length || logoSlugs.size !== EXPECTED_COUNT ||
      [...sourceSlugs].some(slug => festivalLogoFallbacks.has(slug) === logoSlugs.has(slug)) ||
      [...logoSlugs].some(slug => !sourceSlugs.has(slug))) throw new Error('Logo festival coverage mismatch');
  const rows: ReviewedLogo[] = [];
  for (const row of expected) {
    if (!/^[a-z0-9-]+[.]png$/.test(row.file) || row.file !== row.slug + '.png' ||
        festivalLogoPath(row.slug) !== '/api/logos/' + row.file ||
        !Object.values(TYPES).includes(row.mimeType) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error('Invalid reviewed logo mapping');
    }
    const filename = path.join(directory, row.file);
    // No lstat/read race: validate and read the same non-symlink descriptor.
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Logo source must be a regular file');
      if (stat.size !== row.sizeBytes || stat.size > MAX_LOGO_BYTES) throw new Error('Reviewed logo content mismatch');
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    const parsed = await decodeReviewedLogo(bytes, row.mimeType);
    if (parsed.sha256 !== row.sha256 || parsed.sizeBytes !== row.sizeBytes) throw new Error('Reviewed logo content mismatch');
    rows.push({ ...row, bytes });
  }
  return rows;
}

/** Read-only exact comparison of every binding, hash, MIME and byte payload. */
export async function verifyReviewedLogos(db: PrismaClient | Prisma.TransactionClient, rows: ReviewedLogo[]): Promise<{ bound: number; distinctHashes: number }> {
  // Prisma may load included relations with separate queries. Use one read-only
  // snapshot for standalone verify/read-back, or reuse the locked write transaction.
  if ('$transaction' in db) {
    return db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return verifyReviewedLogos(tx, rows);
    }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
  }
  const bindings = await db.festivalLogo.findMany({ include: { festival: { select: { slug: true } }, asset: true } });
  if (bindings.length !== rows.length) throw new Error('Logo binding coverage mismatch');
  const bySlug = new Map(bindings.map(binding => [binding.festival.slug, binding]));
  for (const row of rows) {
    const binding = bySlug.get(row.slug);
    if (!binding || binding.assetHash !== row.sha256 || binding.asset.mimeType !== row.mimeType ||
        binding.asset.sizeBytes !== row.sizeBytes || !Buffer.from(binding.asset.bytes).equals(row.bytes)) {
      throw new Error('Logo binding/hash parity mismatch');
    }
  }
  return { bound: rows.length, distinctHashes: new Set(rows.map(row => row.sha256)).size };
}

function assertReviewedRows(rows: ReviewedLogo[]) {
  if (rows.length !== EXPECTED_COUNT || new Set(rows.map(row => row.slug)).size !== EXPECTED_COUNT) throw new Error('Incomplete reviewed inventory');
  const pinned = new Map(inventory.map(row => [row.slug, row]));
  for (const row of rows) {
    const expected = pinned.get(row.slug);
    if (!expected || expected.file !== row.file || expected.mimeType !== row.mimeType ||
        expected.sizeBytes !== row.sizeBytes || expected.sha256 !== row.sha256) {
      throw new Error('Per-festival reviewed logo mismatch');
    }
  }
}

/** Read-only target preflight: never overwrite a manually assigned or inconsistent binding. */
export async function previewReviewedLogos(db: PrismaClient | Prisma.TransactionClient, rows: ReviewedLogo[]) {
  assertReviewedRows(rows);
  const dbFestivals = await db.festival.findMany({ select: { slug: true } });
  if (dbFestivals.length !== festivals.length || new Set(dbFestivals.map(f => f.slug)).size !== festivals.length ||
      festivals.some(f => !dbFestivals.some(target => target.slug === f.slug))) throw new Error('Database festival coverage mismatch');
  const existing = await db.festivalLogo.findMany({ include: { festival: { select: { slug: true } }, asset: true } });
  for (const binding of existing) {
    const row = rows.find(row => row.slug === binding.festival.slug);
    if (!row || row.sha256 !== binding.assetHash || row.mimeType !== binding.asset.mimeType ||
        row.sizeBytes !== binding.asset.sizeBytes || !Buffer.from(binding.asset.bytes).equals(row.bytes)) {
      throw new Error('Existing festival logo conflict');
    }
  }
  return { matchedFestivals: rows.length, existingBindings: existing.length, missingBindings: rows.length - existing.length, writes: 0 };
}

/** No write before complete source and DB preflight; all inserts/bindings atomic. */
export async function applyReviewedLogos(db: PrismaClient, sourceRows: ReviewedLogo[], expectedExisting?: number) {
  // Own the buffers across asynchronous decode/transaction boundaries.
  const rows = sourceRows.map(row => ({ ...row, bytes: Buffer.from(row.bytes) }));
  assertReviewedRows(rows);
  for (const row of rows) {
    const decoded = await decodeReviewedLogo(row.bytes, row.mimeType);
    if (decoded.sha256 !== row.sha256 || decoded.sizeBytes !== row.sizeBytes) throw new Error('Logo content changed before apply');
  }
  return db.$transaction(async tx => {
    // Block catalog edits and asset/binding writers until commit, including inserts
    // into previously absent rows. Lock order is fixed; bounded wait fails closed.
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
    await tx.$executeRawUnsafe('LOCK TABLE "Festival", "AssetBlob", "FestivalLogo" IN SHARE ROW EXCLUSIVE MODE');
    if (inventoryDigest(rows) !== PINNED_REVIEWED_DIGEST) throw new Error('Before-write inventory digest changed');
    const preview = await previewReviewedLogos(tx, rows);
    if (expectedExisting !== undefined && preview.existingBindings !== expectedExisting) {
      throw new Error('Before-write binding count changed');
    }
    const festivalsInDb = await tx.festival.findMany({ select: { id: true, slug: true } });
    const bySlug = new Map(festivalsInDb.map(f => [f.slug, f.id]));
    const existing = await tx.festivalLogo.findMany({ select: { festivalId: true } });
    for (const row of rows) {
      await tx.$executeRawUnsafe('INSERT INTO "AssetBlob" ("sha256", "mimeType", "sizeBytes", "bytes") VALUES ($1, $2, $3, $4) ON CONFLICT ("sha256") DO NOTHING',
        row.sha256, row.mimeType, row.sizeBytes, row.bytes);
      const blob = await tx.assetBlob.findUniqueOrThrow({ where: { sha256: row.sha256 } });
      if (blob.mimeType !== row.mimeType || blob.sizeBytes !== row.sizeBytes || !Buffer.from(blob.bytes).equals(row.bytes)) {
        throw new Error('Stored logo hash collision or corruption');
      }
      const festivalId = bySlug.get(row.slug)!;
      if (!existing.some(binding => binding.festivalId === festivalId)) {
        await tx.festivalLogo.create({ data: { festivalId, assetHash: row.sha256 } });
      }
    }
    // Detect trigger-induced corruption before commit as well as after commit.
    return verifyReviewedLogos(tx, rows);
  }, { isolationLevel: 'Serializable', timeout: 60_000 });
}

export function inventoryDigest(rows: ReviewedLogo[]) {
  return createHash('sha256').update(rows.map(row => [row.slug, row.mimeType, row.sizeBytes, row.sha256].join('\t') + '\n').join('')).digest('hex');
}
