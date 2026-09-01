import { db } from "@/lib/db";
import { error } from "@/lib/api";
import { verificationTokenHash } from "@/lib/email-verification";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 20 || token.length > 200) return error("Invalid verification token.");
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash: verificationTokenHash(token) } });
  if (!record || record.expiresAt <= new Date()) {
    if (record) await db.emailVerificationToken.delete({ where: { id: record.id } });
    return error("Verification token is invalid or expired.", 410);
  }
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    db.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);
  const destination = new URL("/notifications/", process.env.APP_URL || request.url);
  destination.searchParams.set("email", "verified");
  return Response.redirect(destination, 303);
}
