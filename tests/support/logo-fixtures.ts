import sharp from "sharp";
import { validateLogo, type LogoMimeType } from "../../lib/catalog/logo-assets.ts";
export async function logoFixture(mimeType: LogoMimeType = "image/png", color = "#336699") {
  const image = sharp({ create: { width: 2, height: 2, channels: 3, background: color } });
  const bytes = await (mimeType === "image/jpeg" ? image.jpeg() : image.png()).toBuffer();
  const { sha256, sizeBytes } = validateLogo(bytes, mimeType);
  return { slug: "synthetic-logo", file: "synthetic-logo.png", bytes, mimeType, sha256, sizeBytes, etag: `"${sha256}"` };
}
