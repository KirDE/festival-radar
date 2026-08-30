import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "ok",
      commit: process.env.DEPLOYED_COMMIT || "development",
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        database: "unavailable",
        commit: process.env.DEPLOYED_COMMIT || "development",
      },
      { status: 503 },
    );
  }
}
