import { db } from "@/lib/db";
import { pruneAnalytics } from "@/lib/analytics-retention";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

export async function POST(request: Request) {
  const token = process.env.ANALYTICS_RETENTION_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }

  try {
    return Response.json(await pruneAnalytics(db, process.env.ANALYTICS_RETENTION_DAYS), { headers });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("ANALYTICS_RETENTION_DAYS")) {
      return Response.json({ error: cause.message }, { status: 503, headers });
    }
    throw cause;
  }
}
