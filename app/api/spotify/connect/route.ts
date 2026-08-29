import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser, error } from "@/lib/api";
import { spotifyConfig, spotifyEndpoints } from "@/lib/spotify";

export async function GET() {
  if (!(await requireUser())) return error("Authentication required.", 401);
  try {
    const config = spotifyConfig();
    const state = randomBytes(24).toString("base64url");
    (await cookies()).set("spotify_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
    const url = new URL(`${spotifyEndpoints().accounts}/authorize`);
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, state, scope: "playlist-read-private playlist-read-collaborative" }).toString();
    return Response.redirect(url);
  } catch { return error("Spotify OAuth is not configured.", 503); }
}
