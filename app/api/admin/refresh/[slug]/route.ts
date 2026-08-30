import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { refreshFestival } from "@/lib/admin-store";
import { error } from "@/lib/api";

export async function POST(_: Request, { params }: { params: Promise<{ slug: string }> }) { const admin = await currentAdmin(); if (!admin) return error("Forbidden", 403); try { return NextResponse.json(await refreshFestival((await params).slug, admin), { status: 201 }); } catch (cause) { return error(cause instanceof Error ? cause.message : "Refresh failed", 502); } }
