import { cookies } from "next/headers";
import { z } from "zod";
import { COSEALG } from "@simplewebauthn/server/helpers";
import { decrypt, encrypt } from "@/lib/secrets";

const CEREMONY_COOKIE = "festival_radar_passkey_ceremony";
const CEREMONY_SECONDS = 5 * 60;
export const PASSKEY_ALGORITHMS: number[] = [COSEALG.ES256, COSEALG.EdDSA, COSEALG.RS256];

const ceremonySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("registration"),
    challenge: z.string().min(16).max(512),
    email: z.email(),
    userId: z.string().min(16).max(512),
    expiresAt: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("authentication"),
    challenge: z.string().min(16).max(512),
    expiresAt: z.number().int().positive(),
  }),
]);

export type PasskeyCeremony = z.infer<typeof ceremonySchema>;
type PendingPasskeyCeremony = PasskeyCeremony extends infer Ceremony
  ? Ceremony extends PasskeyCeremony ? Omit<Ceremony, "expiresAt"> : never
  : never;

export function passkeyConfig() {
  if (!process.env.APP_URL) throw new Error("APP_URL is required for passkey authentication");
  const appUrl = new URL(process.env.APP_URL);
  const local = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1" || appUrl.hostname === "[::1]";
  if (appUrl.protocol !== "https:" && !(local && appUrl.protocol === "http:")) {
    throw new Error("Passkey authentication requires HTTPS");
  }
  return { origin: appUrl.origin, rpID: appUrl.hostname, rpName: "Festival Radar" };
}

export async function setPasskeyCeremony(ceremony: PendingPasskeyCeremony) {
  const expiresAt = Date.now() + CEREMONY_SECONDS * 1000;
  (await cookies()).set(CEREMONY_COOKIE, encrypt(JSON.stringify({ ...ceremony, expiresAt })), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/passkey",
    maxAge: CEREMONY_SECONDS,
    priority: "high",
  });
}

export async function consumePasskeyCeremony<T extends PasskeyCeremony["kind"]>(kind: T) {
  const jar = await cookies();
  const value = jar.get(CEREMONY_COOKIE)?.value;
  jar.delete(CEREMONY_COOKIE);
  if (!value) return null;
  try {
    const parsed = ceremonySchema.safeParse(JSON.parse(decrypt(value)));
    if (!parsed.success || parsed.data.kind !== kind || parsed.data.expiresAt <= Date.now()) return null;
    return parsed.data as Extract<PasskeyCeremony, { kind: T }>;
  } catch {
    return null;
  }
}
