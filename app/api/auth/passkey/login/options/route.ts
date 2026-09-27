import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { error } from "@/lib/api";
import { passkeyConfig, setPasskeyCeremony } from "@/lib/passkeys";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  try {
    const { rpID } = passkeyConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      timeout: 60_000,
    });
    await setPasskeyCeremony({ kind: "authentication", challenge: options.challenge });
    return Response.json({ options });
  } catch {
    return error("Passkey sign-in is unavailable.", 503);
  }
}
