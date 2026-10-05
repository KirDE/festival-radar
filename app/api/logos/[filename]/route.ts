import { db } from "@/lib/db";
import { databaseLogoReader, serveFestivalLogo } from "@/lib/catalog/logo-serving";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ filename: string }> };

export async function GET(request: Request, context: Context) {
  const { filename } = await context.params;
  return serveFestivalLogo(request, filename, databaseLogoReader(db));
}

export const HEAD = GET;
