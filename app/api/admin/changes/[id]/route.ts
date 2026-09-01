import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { decideChange } from "@/lib/admin-store";
import { error } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const originError = rejectUntrustedOrigin(request); if (originError) return originError; const admin = await currentAdmin(); if (!admin) return error("Forbidden", 403); const body = await request.json(); if (body.decision !== "approve" && body.decision !== "reject") return error("Invalid decision"); try { return NextResponse.json(await decideChange((await params).id, body.decision, admin)); } catch (cause) { return error(cause instanceof Error ? cause.message : "Decision failed", 409); } }
