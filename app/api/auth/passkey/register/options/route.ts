import { generateRegistrationOptions } from "@simplewebauthn/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { error } from "@/lib/api";
import { PASSKEY_ALGORITHMS, passkeyConfig, setPasskeyCeremony } from "@/lib/passkeys";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

const input = z.object({ email: z.email() });

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("A valid email is required.");
  const email = parsed.data.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return error("This email is already registered.", 409);
  }

  try {
    const { rpID, rpName } = passkeyConfig();
    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userName: email,
      userDisplayName: email,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
      timeout: 60_000,
    });
    await setPasskeyCeremony({ kind: "registration", challenge: options.challenge, email, userId: options.user.id });
    return Response.json({ options });
  } catch {
    return error("Passkey registration is unavailable.", 503);
  }
}
