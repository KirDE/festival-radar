import { after, NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { decideChange } from "@/lib/admin-store";
import { error } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export const maxDuration = 2_700;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectUntrustedOrigin(request); if (originError) return originError;
  const admin = await currentAdmin(); if (!admin) return error("Forbidden", 403);
  const body = await request.json();
  if (body.decision !== "approve" && body.decision !== "reject") return error("Invalid decision");
  try {
    const result = await decideChange((await params).id, body.decision, admin);
    if (result.playlistRefreshRequested && process.env.APP_URL && process.env.INTERNAL_API_SECRET) {
      const url = new URL("/api/playlists/run/", process.env.APP_URL);
      after(async () => {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`, "content-type": "application/json" },
            body: JSON.stringify({ festivals: [result.resourceKey] }),
            signal: AbortSignal.timeout(2_650_000),
          });
          if (!response.ok) console.error(`Admin playlist refresh failed with HTTP ${response.status}`);
        } catch (cause) {
          console.error("Admin playlist refresh failed", cause instanceof Error ? cause.message : "unknown error");
        }
      });
    }
    return NextResponse.json(result);
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Decision failed", 409); }
}
