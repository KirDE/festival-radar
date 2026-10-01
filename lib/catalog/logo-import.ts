import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import type { PrismaClient } from '@prisma/client';
import { festivalLogoFallbacks, festivalLogoPath } from '../../data/festival-logos.ts';
import { festivals } from '../../data/festivals.ts';
import { MAX_LOGO_BYTES, validateLogo, type LogoMimeType } from './logo-assets.ts';
import inventory from '../../data/reviewed-logo-inventory.json' with { type: 'json' };

export type ReviewedLogo = { slug: string; file: string; mimeType: LogoMimeType; sizeBytes: number; sha256: string; bytes: Buffer };
export const LOGO_DIRECTORY = fileURLToPath(new URL('../../public/logos/', import.meta.url));
const TYPES: Record<string, LogoMimeType> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXPECTED_COUNT = 47;

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
        festivalLogoPath(row.slug) !== '/logos/' + row.file ||
        !Object.values(TYPES).includes(row.mimeType) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error('Invalid reviewed logo mapping');
    }
    const filename = path.join(directory, row.file);
    if (!(await lstat(filename)).isFile()) throw new Error('Logo source must be a regular file');
    const bytes = await readFile(filename);
    const parsed = await decodeReviewedLogo(bytes, row.mimeType);
    if (parsed.sha256 !== row.sha256 || parsed.sizeBytes !== row.sizeBytes) throw new Error('Reviewed logo content mismatch');
    rows.push({ ...row, bytes });
  }
  return rows;
}

/** Read-only exact comparison of every binding, hash, MIME and byte payload. */
export async function verifyReviewedLogos(db: PrismaClient, rows: ReviewedLogo[]) {
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
export async function previewReviewedLogos(db: PrismaClient, rows: ReviewedLogo[]) {
  assertReviewedRows(rows);
  const dbFestivals = await db.festival.findMany({ select: { slug: true } });
  if (dbFestivals.length !== festivals.length || rows.length !== EXPECTED_COUNT ||
      rows.some(row => !dbFestivals.some(f => f.slug === row.slug))) throw new Error('Database festival coverage mismatch');
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
export async function applyReviewedLogos(db: PrismaClient, rows: ReviewedLogo[]) {
  assertReviewedRows(rows);
  await previewReviewedLogos(db, rows);
  const festivalsInDb = await db.festival.findMany({ select: { id: true, slug: true } });
  const bySlug = new Map(festivalsInDb.map(f => [f.slug, f.id]));
  if (festivalsInDb.length !== festivals.length || rows.some(row => !bySlug.has(row.slug))) throw new Error('Database festival coverage mismatch');
  for (const row of rows) {
    const decoded = await decodeReviewedLogo(row.bytes, row.mimeType);
    if (decoded.sha256 !== row.sha256 || decoded.sizeBytes !== row.sizeBytes) throw new Error('Logo content changed before apply');
  }
  return db.$transaction(async tx => {
    const existing = await tx.festivalLogo.findMany({ include: { festival: { select: { slug: true } }, asset: true } });
    const expected = new Map(rows.map(row => [row.slug, row]));
    for (const binding of existing) {
      const row = expected.get(binding.festival.slug);
      if (!row || binding.assetHash !== row.sha256 || binding.asset.mimeType !== row.mimeType ||
          binding.asset.sizeBytes !== row.sizeBytes || !Buffer.from(binding.asset.bytes).equals(row.bytes)) {
        throw new Error('Existing festival logo conflict');
      }
    }
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
    return { bound: rows.length, distinctHashes: new Set(rows.map(row => row.sha256)).size };
  }, { timeout: 60_000 });
}

export function inventoryDigest(rows: ReviewedLogo[]) {
  return createHash('sha256').update(rows.map(row => [row.slug, row.mimeType, row.sizeBytes, row.sha256].join('\t') + '\n').join('')).digest('hex');
}
