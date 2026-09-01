import { db } from "@/lib/db";
import { error } from "@/lib/api";
import { verificationTokenHash } from "@/lib/email-verification";
import { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 20 || token.length > 200) return error("Invalid verification token.");
  const verified = await db.$transaction(async (tx) => {
    const [consumed] = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
      DELETE FROM "EmailVerificationToken"
      WHERE "tokenHash" = ${verificationTokenHash(token)} AND "expiresAt" > NOW()
      RETURNING "userId"
    `);
    if (!consumed) return false;
    await tx.user.update({ where: { id: consumed.userId }, data: { emailVerifiedAt: new Date() } });
    await tx.emailVerificationToken.deleteMany({ where: { userId: consumed.userId } });
    return true;
  });
  if (!verified) return error("Verification token is invalid or expired.", 410);
  const destination = new URL("/notifications/", process.env.APP_URL || request.url);
  destination.searchParams.set("email", "verified");
  return Response.redirect(destination, 303);
}
