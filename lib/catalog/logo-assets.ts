import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export type LogoMimeType = "image/png" | "image/jpeg" | "image/webp";

// Only locally supplied, reviewed images should enter this store. Never fetch arbitrary URLs here.
export function validateLogo(bytes: Uint8Array, mimeType: LogoMimeType) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error("Logo must contain 1–2097152 bytes");
  }
  const image = Buffer.from(bytes);
  const png = image.length >= 33 && image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    && image.readUInt32BE(8) === 13 && image.toString("ascii", 12, 16) === "IHDR"
    && image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0
    && image.subarray(-8, -4).toString("ascii") === "IEND";
  const jpeg = image.length >= 4 && image[0] === 0xff && image[1] === 0xd8
    && image[2] === 0xff && image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9;
  const webp = image.length >= 20 && image.toString("ascii", 0, 4) === "RIFF"
    && image.readUInt32LE(4) === image.length - 8 && image.toString("ascii", 8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(image.toString("ascii", 12, 16));
  if (!({ "image/png": png, "image/jpeg": jpeg, "image/webp": webp } as Record<string, boolean>)[mimeType]) {
    throw new Error("Unsupported or mismatched logo MIME/signature");
  }
  return { sha256: createHash("sha256").update(image).digest("hex"), sizeBytes: image.length, image };
}

/** Dormant storage API; no runtime route or static-logo lookup calls this yet. */
export async function saveFestivalLogo(db: PrismaClient, slug: string, bytes: Uint8Array, mimeType: LogoMimeType) {
  const { sha256, sizeBytes, image } = validateLogo(bytes, mimeType);
  return db.$transaction(async (tx) => {
    const festival = await tx.festival.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    await tx.assetBlob.upsert({
      where: { sha256 }, create: { sha256, mimeType, sizeBytes, bytes: image }, update: {},
    });
    await tx.festivalLogo.upsert({
      where: { festivalId: festival.id }, create: { festivalId: festival.id, assetHash: sha256 },
      update: { assetHash: sha256 },
    });
    return { sha256, etag: '"' + sha256 + '"', mimeType, sizeBytes };
  });
}

export async function readFestivalLogo(db: PrismaClient, slug: string) {
  const logo = await db.festivalLogo.findFirst({
    where: { festival: { slug } }, include: { asset: true },
  });
  if (!logo) return null;
  return {
    bytes: logo.asset.bytes, mimeType: logo.asset.mimeType,
    sha256: logo.assetHash, etag: '"' + logo.assetHash + '"',
  };
}
