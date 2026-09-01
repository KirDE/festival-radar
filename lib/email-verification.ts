import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.ts";

const tokenLifetimeMs = 30 * 60 * 1000;
const resendDelayMs = 60 * 1000;

export const verificationTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createEmailVerification(user: { id: string; email: string }) {
  const recent = await db.emailVerificationToken.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  if (recent && Date.now() - recent.createdAt.getTime() < resendDelayMs) return { status: "rate_limited" as const };
  const token = randomBytes(32).toString("base64url");
  const record = await db.$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    return tx.emailVerificationToken.create({ data: { userId: user.id, tokenHash: verificationTokenHash(token), expiresAt: new Date(Date.now() + tokenLifetimeMs) } });
  });
  return { status: "created" as const, token, record };
}

export async function sendEmailVerification(user: { email: string }, token: string, idempotencyKey: string) {
  const provider = process.env.EMAIL_WEBHOOK_URL;
  const appUrl = process.env.APP_URL;
  if (!provider || !appUrl) throw new Error("Email verification provider is not configured");
  const confirmation = new URL("/api/auth/email-verification/confirm", appUrl);
  confirmation.searchParams.set("token", token);
  const response = await fetch(provider, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ kind: "email-verification", to: user.email, subject: "Verify your Festival Radar email", text: `Verify this address within 30 minutes: ${confirmation}` }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}
