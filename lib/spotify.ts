import { decrypt } from "@/lib/secrets";

export const spotifyConfig = () => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) throw new Error("Spotify OAuth is not configured");
  return { clientId, clientSecret, redirectUri: `${appUrl.replace(/\/$/, "")}/api/spotify/callback` };
};

export async function spotifyAccessToken(encryptedRefreshToken: string) {
  const config = spotifyConfig();
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decrypt(encryptedRefreshToken) }), cache: "no-store",
  });
  if (!response.ok) throw new Error("Spotify token refresh failed");
  return (await response.json() as { access_token: string }).access_token;
}
