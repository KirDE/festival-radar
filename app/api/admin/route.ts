import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { adminSnapshot, saveDraft } from "@/lib/admin-store";
import { error } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function GET() { const admin = await currentAdmin(); return admin ? NextResponse.json(await adminSnapshot()) : error("Forbidden", 403); }
export async function POST(request: Request) { const originError = rejectUntrustedOrigin(request); if (originError) return originError; const admin = await currentAdmin(); if (!admin) return error("Forbidden", 403); try { return NextResponse.json(await saveDraft(await request.json(), admin), { status: 201 }); } catch (cause) { return error(cause instanceof Error ? cause.message : "Invalid draft", 409); } }
