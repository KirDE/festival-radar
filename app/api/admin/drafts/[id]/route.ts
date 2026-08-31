import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { deleteDraft, updateDraft } from "@/lib/admin-store";
import { error } from "@/lib/api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentAdmin();
  if (!admin) return error("Forbidden", 403);
  try { return NextResponse.json(await updateDraft((await params).id, (await request.json()).values, admin)); }
  catch (cause) { return error(cause instanceof Error ? cause.message : "Draft update failed", 409); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentAdmin();
  if (!admin) return error("Forbidden", 403);
  try { return NextResponse.json(await deleteDraft((await params).id, admin)); }
  catch (cause) { return error(cause instanceof Error ? cause.message : "Draft delete failed", 409); }
}
