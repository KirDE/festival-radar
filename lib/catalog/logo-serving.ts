import type { PrismaClient } from "@prisma/client";
import { reviewedLogoFile } from "../../data/logo-serving.ts";
import { readFestivalLogo, validateLogo, type LogoMimeType } from "./logo-assets.ts";

type LogoReader = (slug: string) => ReturnType<typeof readFestivalLogo>;

function unavailable(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** Public, reviewed festival logos only; never expose a generic AssetBlob reader. */
export async function serveFestivalLogo(
  request: Request,
  filename: string,
  readLogo: LogoReader,
) {
  const reviewed = reviewedLogoFile(filename);
  if (!reviewed) return unavailable(404);
  try {
    const logo = await readLogo(reviewed.slug);
    if (!logo) return unavailable(404);
    // A changed/manual binding must be separately reviewed before public activation.
    if (logo.sha256 !== reviewed.sha256 || logo.mimeType !== reviewed.mimeType
      || logo.bytes.byteLength !== reviewed.sizeBytes
      || validateLogo(logo.bytes, logo.mimeType as LogoMimeType).sha256 !== reviewed.sha256) {
      return unavailable(503);
    }
    const headers = new Headers({
      "Content-Type": logo.mimeType,
      "X-Content-Type-Options": "nosniff",
      "ETag": logo.etag,
      // Filename URLs are mutable bindings, so every reuse must revalidate.
      "Cache-Control": "public, max-age=0, must-revalidate",
    });
    const matches = request.headers.get("if-none-match")?.split(",").some((value) => {
      const tag = value.trim();
      return tag === "*" || tag === logo.etag || tag === `W/${logo.etag}`;
    });
    if (matches) return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(logo.bytes.byteLength));
    return new Response(request.method === "HEAD" ? null : new Uint8Array(logo.bytes), { headers });
  } catch {
    // Never send database errors/connection details to a public client or cache them.
    return unavailable(503);
  }
}

export function databaseLogoReader(db: PrismaClient): LogoReader {
  return (slug) => readFestivalLogo(db, slug);
}
