import { db } from "@/lib/db";
import { error, requireUser } from "@/lib/api";
import { createEmailVerification, sendEmailVerification } from "@/lib/email-verification";

export async function POST() {
  const sessionUser = await requireUser();
  if (!sessionUser) return error("Authentication required.", 401);
  if (sessionUser.emailVerified) return Response.json({ verified: true });
  if (!process.env.EMAIL_WEBHOOK_URL || !process.env.APP_URL) return error("Email verification is unavailable.", 503);
  const created = await createEmailVerification(sessionUser);
  if (created.status === "rate_limited") return error("A verification email was sent recently. Try again later.", 429);
  try {
    await sendEmailVerification(sessionUser, created.token, created.record.id);
  } catch {
    await db.emailVerificationToken.deleteMany({ where: { id: created.record.id } });
    return error("Email verification could not be sent.", 502);
  }
  return Response.json({ sent: true }, { status: 202 });
}
