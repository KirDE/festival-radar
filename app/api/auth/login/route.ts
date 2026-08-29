import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { error } from "@/lib/api";

const input = z.object({ email: z.email(), password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Invalid credentials.", 401);
  const user = await db.user.findUnique({ where: { email: parsed.data.email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return error("Invalid credentials.", 401);
  await createSession(user.id);
  return Response.json({ user: { id: user.id, email: user.email } });
}
