import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { parserRunLog } from "@/lib/admin-store";
import { error } from "@/lib/api";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentAdmin();
  if (!admin) return error("Forbidden", 403);
  try {
    return NextResponse.json(await parserRunLog((await params).id));
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Parser log read failed", 404);
  }
}
