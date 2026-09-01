import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { refreshFestival } from "@/lib/admin-store";
import { error } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

<<<<<<< HEAD
export async function POST(_: Request, { params }: { params: Promise<{ slug: string }> }) { const admin = await currentAdmin(["ADMIN"]); if (!admin) return error("Forbidden", 403); try { return NextResponse.json(await refreshFestival((await params).slug, admin), { status: 201 }); } catch (cause) { return error(cause instanceof Error ? cause.message : "Refresh failed", 502); } }
=======
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const originError = rejectUntrustedOrigin(request); if (originError) return originError; const admin = await currentAdmin(); if (!admin) return error("Forbidden", 403); try { return NextResponse.json(await refreshFestival((await params).slug, admin), { status: 201 }); } catch (cause) { return error(cause instanceof Error ? cause.message : "Refresh failed", 502); } }
>>>>>>> 20517a6 (Enforce trusted origins on session mutations)
