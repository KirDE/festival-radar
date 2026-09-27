import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { error } from "@/lib/api";
import { consumePasskeyCeremony, passkeyConfig } from "@/lib/passkeys";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

const responseSchema = z.object({ id: z.string().min(1).max(2048) }).passthrough();

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const parsed = responseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Invalid passkey response.", 401);
  const ceremony = await consumePasskeyCeremony("authentication");
  if (!ceremony) return error("Passkey sign-in expired. Please try again.", 401);

  try {
    const response = parsed.data as unknown as AuthenticationResponseJSON;
    const passkey = await db.passkey.findUnique({ where: { id: response.id }, include: { user: true } });
    if (!passkey) return error("Passkey sign-in failed.", 401);
    if (response.response.userHandle && response.response.userHandle !== passkey.userHandle) {
      return error("Passkey sign-in failed.", 401);
    }
    const { origin, rpID } = passkeyConfig();
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
    });
    if (!verification.verified) return error("Passkey sign-in failed.", 401);

    await db.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: new Date(),
      },
    });
    await createSession(passkey.userId);
    return Response.json({ user: { id: passkey.user.id, email: passkey.user.email } });
  } catch {
    return error("Passkey sign-in failed.", 401);
  }
}
