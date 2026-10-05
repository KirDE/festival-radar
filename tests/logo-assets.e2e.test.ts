import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { MAX_LOGO_BYTES, readFestivalLogo, saveFestivalLogo, validateLogo } from "../lib/catalog/logo-assets.ts";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) {
  throw new Error("A disposable test/integration DATABASE_URL is required");
}
const db = new PrismaClient();
const slugs = [randomUUID(), randomUUID()].map((id) => 'asset-test-' + id);
// Some repository .png names contain JPEG bytes; MIME must follow content, not extension.
const logos = ["greenfield.png", "rock-for-people.png", "barcelona-rock-fest.png"];
let images: Buffer[];

test.before(async () => {
  images = await Promise.all(logos.map((file) => readFile(new URL('../source-inputs/reviewed-logos/' + file, import.meta.url))));
  for (const slug of slugs) await db.festival.create({ data: {
    slug, name: "Disposable asset test", country: "DE", countryCode: "DE", officialUrl: "https://example.org",
    genres: [],
  } });
});
test.after(async () => {
  await db.festival.deleteMany({ where: { slug: { in: slugs } } });
  for (const [index, image] of (images ?? []).entries()) {
    const hash = validateLogo(image, index === 2 ? "image/jpeg" : "image/png").sha256;
    await db.assetBlob.deleteMany({ where: { sha256: hash } });
  }
  await db.$disconnect();
});

test("reviewed image bytes dedupe by hash, retain immutable ETag and replace festival binding", async () => {
  const first = await saveFestivalLogo(db, slugs[0], images[0], "image/png");
  const second = await saveFestivalLogo(db, slugs[1], images[0], "image/png");
  assert.equal(first.sha256, second.sha256);
  assert.match(first.etag, /^"[0-9a-f]{64}"$/);
  assert.equal(await db.assetBlob.count({ where: { sha256: first.sha256 } }), 1);
  assert.equal((await readFestivalLogo(db, slugs[0]))?.etag, first.etag);
  assert.deepEqual(Buffer.from((await readFestivalLogo(db, slugs[1]))!.bytes), images[0]);
  const replaced = await saveFestivalLogo(db, slugs[0], images[1], "image/png");
  assert.notEqual(replaced.etag, first.etag);
  assert.equal((await readFestivalLogo(db, slugs[1]))?.etag, first.etag);
  assert.equal((await readFestivalLogo(db, slugs[0]))?.etag, replaced.etag);
  const jpeg = await saveFestivalLogo(db, slugs[0], images[2], "image/jpeg");
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.equal((await readFestivalLogo(db, slugs[0]))?.etag, jpeg.etag);
  assert.equal((await readFestivalLogo(db, slugs[0]))?.mimeType, "image/jpeg");
  assert.equal(await readFestivalLogo(db, "does-not-exist"), null);
});

test("two independent clients save the same hash concurrently without a uniqueness race", async () => {
  const other = new PrismaClient();
  try {
    await saveFestivalLogo(db, slugs[1], images[1], "image/png");
    const hash = validateLogo(images[0], "image/png").sha256;
    await db.assetBlob.delete({ where: { sha256: hash } });
    assert.equal(await db.assetBlob.count({ where: { sha256: hash } }), 0);
    const [first, second] = await Promise.all([
      saveFestivalLogo(db, slugs[0], images[0], "image/png"),
      saveFestivalLogo(other, slugs[1], images[0], "image/png"),
    ]);
    assert.equal(first.sha256, second.sha256);
    assert.equal(await db.assetBlob.count({ where: { sha256: first.sha256 } }), 1);
    assert.equal((await readFestivalLogo(db, slugs[0]))?.sha256, first.sha256);
    assert.equal((await readFestivalLogo(other, slugs[1]))?.sha256, first.sha256);
  } finally {
    await other.$disconnect();
  }
});

test("invalid MIME, oversize, and malformed bytes are rejected before database writes", async () => {
  const previous = (await readFestivalLogo(db, slugs[0]))?.sha256;
  assert.throws(() => validateLogo(images[0], "image/jpeg"), /MIME/);
  assert.throws(() => validateLogo(images[0], "text/html" as never), /MIME/);
  assert.throws(() => validateLogo(Buffer.from("<svg><script/></svg>"), "image/png"), /MIME/);
  assert.throws(() => validateLogo(new Uint8Array(MAX_LOGO_BYTES + 1), "image/png"), /bytes/);
  await assert.rejects(saveFestivalLogo(db, slugs[0], images[0], "image/webp"), /MIME/);
  const row = await readFestivalLogo(db, slugs[0]);
  assert.equal(row?.sha256, previous);
});

test("database constraints reject invalid MIME, lengths, and SHA-256 digest", async () => {
  const valid = validateLogo(images[0], "image/png");
  await assert.rejects(db.assetBlob.create({ data: {
    sha256: 'a'.repeat(64), mimeType: "image/svg+xml", bytes: new Uint8Array(images[0]), sizeBytes: valid.sizeBytes,
  } }));
  await assert.rejects(db.assetBlob.create({ data: {
    sha256: 'b'.repeat(64), mimeType: "image/png", bytes: new Uint8Array(images[0]), sizeBytes: valid.sizeBytes + 1,
  } }));
  await assert.rejects(db.assetBlob.create({ data: {
    sha256: 'c'.repeat(64), mimeType: "image/png", bytes: new Uint8Array(images[0]), sizeBytes: valid.sizeBytes,
  } }));
  assert.equal(await db.assetBlob.count({ where: { sha256: { in: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] } } }), 0);
});

test("a preexisting hash with mismatched MIME cannot be bound", async () => {
  const hash = validateLogo(images[1], "image/png").sha256;
  const previous = (await readFestivalLogo(db, slugs[0]))?.sha256;
  await db.assetBlob.delete({ where: { sha256: hash } });
  try {
    await db.assetBlob.create({ data: {
      sha256: hash, mimeType: "image/jpeg", sizeBytes: images[1].length, bytes: new Uint8Array(images[1]),
    } });
    await assert.rejects(saveFestivalLogo(db, slugs[0], images[1], "image/png"), /collision or corrupted/);
    assert.equal((await readFestivalLogo(db, slugs[0]))?.sha256, previous);
  } finally {
    await db.assetBlob.deleteMany({ where: { sha256: hash } });
  }
});

test("an existing blob cannot be mutated after a festival binds to it", async () => {
  const hash = validateLogo(images[0], "image/png").sha256;
  const original = await readFestivalLogo(db, slugs[0]);
  await assert.rejects(db.assetBlob.update({
    where: { sha256: hash }, data: { bytes: new Uint8Array(images[1]), sizeBytes: images[1].length },
  }));
  await assert.rejects(db.assetBlob.update({
    where: { sha256: hash }, data: { mimeType: "image/jpeg" },
  }));
  assert.deepEqual(Buffer.from((await readFestivalLogo(db, slugs[0]))!.bytes), Buffer.from(original!.bytes));
});
