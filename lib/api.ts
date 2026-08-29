import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function requireUser() {
  const user = await currentUser();
  return user ?? null;
}
