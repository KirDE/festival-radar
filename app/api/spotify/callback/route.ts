import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { encrypt } from "@/lib/secrets";
import { spotifyConfig, spotifyEndpoints } from "@/lib/spotify";
import { error } from "@/lib/api";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return error("Authentication required.", 401);
  const url = new URL(request.url);
  const jar = await cookies();
  const expectedState = jar.get("spotify_oauth_state")?.value;
  jar.delete("spotify_oauth_state");
  if (!expectedState || url.searchParams.get("state") !== expectedState || !url.searchParams.get("code")) return error("Invalid Spotify OAuth response.", 400);
  const config = spotifyConfig();
  const endpoints = spotifyEndpoints();
  const tokenResponse = await fetch(`${endpoints.accounts}/api/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code")!, redirect_uri: config.redirectUri }), cache: "no-store" });
  if (!tokenResponse.ok) return error("Spotify authorization failed.", 502);
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string };
  const profileResponse = await fetch(`${endpoints.api}/v1/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
  if (!profileResponse.ok) return error("Spotify profile lookup failed.", 502);
  const profile = await profileResponse.json() as { id: string };
  await db.spotifyConnection.upsert({ where: { userId: user.id }, create: { userId: user.id, spotifyUserId: profile.id, encryptedRefreshToken: encrypt(tokens.refresh_token) }, update: { spotifyUserId: profile.id, encryptedRefreshToken: encrypt(tokens.refresh_token) } });
  return Response.redirect(new URL("/?spotify=connected", process.env.APP_URL));
}
