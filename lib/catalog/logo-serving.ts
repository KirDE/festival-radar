import type { PrismaClient } from "@prisma/client";
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
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(filename)) return unavailable(404);
  const slug = filename.slice(0, -4);
  try {
    const logo = await readLogo(slug);
    if (!logo) return unavailable(404);
    // DB binding is authoritative; a valid imported replacement needs no deploy.
    if (validateLogo(logo.bytes, logo.mimeType as LogoMimeType).sha256 !== logo.sha256
      || logo.etag !== '"' + logo.sha256 + '"') return unavailable(503);
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
