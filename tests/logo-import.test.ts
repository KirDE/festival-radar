import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { auditReviewedLogos, decodeReviewedLogo, inventoryDigest, LOGO_DIRECTORY } from '../lib/catalog/logo-import.ts';
import { festivalLogoPath, festivalLogoFallbacks } from '../data/festival-logos.ts';
import { festivals } from '../data/festivals.ts';

const rows = await auditReviewedLogos();
test('reviewed inventory fully decodes, hashes and covers exact static binding', () => {
  assert.equal(rows.length, 47);
  assert.equal(rows.filter(r => r.mimeType === 'image/png').length, 39);
  assert.equal(rows.filter(r => r.mimeType === 'image/jpeg').length, 8);
  assert.equal(rows.filter(r => r.mimeType === 'image/webp').length, 0);
  assert.equal(rows.length + festivalLogoFallbacks.size, festivals.length);
  assert.deepEqual(rows.map(r => r.slug), [...rows.map(r => r.slug)].sort());
  for (const row of rows) {
    assert.equal(festivalLogoPath(row.slug), '/logos/' + row.file);
    assert.equal(createHash('sha256').update(row.bytes).digest('hex'), row.sha256);
    assert.equal(row.bytes.length, row.sizeBytes);
  }
  assert.match(inventoryDigest(rows), /^[a-f0-9]{64}$/);
  for (const slug of festivalLogoFallbacks) assert.equal(festivalLogoPath(slug), null);
});

test('full decoder rejects truncated and corrupt payloads even with valid signatures', async () => {
  const png = rows.find(r => r.mimeType === 'image/png')!;
  const jpeg = rows.find(r => r.mimeType === 'image/jpeg')!;
  const badSignature = Buffer.from(png.bytes);
  badSignature[0] ^= 0xff;
  await assert.rejects(decodeReviewedLogo(badSignature, 'image/png'));
  const truncated = Buffer.concat([png.bytes.subarray(0, 40), png.bytes.subarray(-12)]);
  await assert.rejects(decodeReviewedLogo(truncated, 'image/png'));
  const damaged = Buffer.from(jpeg.bytes);
  damaged.fill(0, Math.floor(damaged.length / 3), Math.floor(damaged.length * 2 / 3));
  await assert.rejects(decodeReviewedLogo(damaged, 'image/jpeg'));
  await assert.rejects(decodeReviewedLogo(jpeg.bytes, 'image/png'), /MIME/);
  await assert.rejects(decodeReviewedLogo(png.bytes, 'image/jpeg'), /MIME/);
  const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).webp().toBuffer();
  assert.equal((await decodeReviewedLogo(webp, 'image/webp')).sizeBytes, webp.length);
  await assert.rejects(decodeReviewedLogo(webp.subarray(0, webp.length - 5), 'image/webp'));
});

test('missing, unexpected, altered or mismatched source inventory fails closed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'festival-logo-inventory-'));
  try {
    await cp(LOGO_DIRECTORY, directory, { recursive: true });
    await writeFile(path.join(directory, 'unexpected.webp'), 'unexpected');
    await assert.rejects(auditReviewedLogos(directory), /inventory differs/);
    await rm(path.join(directory, 'unexpected.webp'));
    const name = rows[0].file;
    await writeFile(path.join(directory, name), rows[1].bytes);
    await assert.rejects(auditReviewedLogos(directory), /content mismatch/);
    await writeFile(path.join(directory, name), rows[0].bytes);
    await rm(path.join(directory, name));
    await assert.rejects(auditReviewedLogos(directory), /inventory differs/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
