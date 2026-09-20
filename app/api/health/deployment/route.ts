import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readCatalog } from "@/lib/catalog/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const snapshot = await readCatalog();
    return NextResponse.json({
      status: "ok",
      database: "ok",
      catalog: "database",
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
        catalog: "database",
        commit: process.env.DEPLOYED_COMMIT || "development",
      },
      { status: 503 },
    );
  }
}
