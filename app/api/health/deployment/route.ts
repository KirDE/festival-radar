import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { catalogReadMode, readCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const catalog = catalogReadMode();
    const snapshot = await readCatalog();
    return NextResponse.json({
      status: "ok",
      database: "ok",
      catalog,
      catalogCounts: {
        festivals: snapshot.festivals.length,
        editions: snapshot.editions.length,
        artists: snapshot.artists.length,
        playlists: Object.keys(snapshot.playlists).length,
      },
      commit: process.env.DEPLOYED_COMMIT || "development",
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unavailable",
        catalog: catalogReadMode(),
        commit: process.env.DEPLOYED_COMMIT || "development",
      },
      { status: 503 },
    );
  }
}
