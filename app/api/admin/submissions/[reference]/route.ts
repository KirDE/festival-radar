import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { decideSubmission } from "@/lib/admin-store";
import { error } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const admin = await currentAdmin();
  if (!admin) return error("Forbidden", 403);
  try {
    const body = await request.json();
    if (!["approve", "reject"].includes(body.decision) || (body.reviewNote && typeof body.reviewNote !== "string")) return error("Invalid decision", 422);
    return NextResponse.json(await decideSubmission((await params).reference, body.decision, (body.reviewNote ?? "").trim().slice(0, 1000), admin));
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Decision failed", 409); }
}
