import { Prisma } from "@prisma/client";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { error } from "@/lib/api";
import { consumePasskeyCeremony, PASSKEY_ALGORITHMS, passkeyConfig } from "@/lib/passkeys";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

const responseSchema = z.object({ id: z.string().min(1).max(2048) }).passthrough();

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const parsed = responseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Invalid passkey response.");
  const ceremony = await consumePasskeyCeremony("registration");
  if (!ceremony) return error("Passkey registration expired. Please try again.", 400);

  try {
    const response = parsed.data as unknown as RegistrationResponseJSON;
    const { origin, rpID } = passkeyConfig();
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
    });
    if (!verification.verified) return error("Passkey registration could not be verified.", 400);

    const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
    const user = await db.$transaction(async (transaction) => {
      const created = await transaction.user.create({ data: { email: ceremony.email, passwordHash: null } });
      await transaction.passkey.create({
        data: {
          id: credential.id,
          userId: created.id,
          userHandle: ceremony.userId,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? response.response.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
        },
      });
      return created;
    });
    await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, emailVerified: false } }, { status: 201 });
  } catch (reason) {
    if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2002") {
      return error("This email or passkey is already registered.", 409);
    }
    return error("Passkey registration could not be verified.", 400);
  }
}
