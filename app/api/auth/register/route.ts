import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { error } from "@/lib/api";

const input = z.object({ email: z.email(), password: z.string().min(12).max(128) });

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("A valid email and a password of at least 12 characters are required.");
  const email = parsed.data.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) return error("This email is already registered.", 409);
  const user = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
  await createSession(user.id);
  return Response.json({ user: { id: user.id, email: user.email, emailVerified: false } }, { status: 201 });
}
