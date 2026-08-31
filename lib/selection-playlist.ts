export type SpotifyRequest = (url: string, init?: RequestInit) => Promise<Response>;

export function deduplicateArtists(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase("en");
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function spotifyJson<T>(request: SpotifyRequest, url: string, init?: RequestInit) {
  const response = await request(url, init);
  if (!response.ok) throw new Error(`Spotify request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function createSelectionPlaylist(input: {
  token: string;
  spotifyUserId: string;
  artists: string[];
  festivals: string[];
  request?: SpotifyRequest;
}) {
  const request = input.request ?? fetch;
  const artists = deduplicateArtists(input.artists).slice(0, 250);
  const headers = { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" };
  const tracks: string[] = [];
  const unresolved: string[] = [];
  for (const artist of artists) {
    const query = new URLSearchParams({ q: `artist:${artist}`, type: "track", limit: "1" });
    const result = await spotifyJson<{ tracks: { items: Array<{ uri: string }> } }>(request, `https://api.spotify.com/v1/search?${query}`, { headers, cache: "no-store" });
    const uri = result.tracks.items[0]?.uri;
    if (uri && !tracks.includes(uri)) tracks.push(uri);
    else unresolved.push(artist);
  }
  if (!tracks.length) throw new Error("Spotify could not resolve any selected artists");
  const suffix = input.festivals.length === 1 ? input.festivals[0] : `${input.festivals.length} festivals`;
  const playlist = await spotifyJson<{ id: string; external_urls: { spotify: string } }>(request, `https://api.spotify.com/v1/users/${encodeURIComponent(input.spotifyUserId)}/playlists`, {
    method: "POST", headers, body: JSON.stringify({ name: `Festival Radar · ${suffix}`, description: `One track per deduplicated artist selected in Festival Radar (${artists.length} artists).`, public: false }),
  });
  for (let index = 0; index < tracks.length; index += 100) {
    await spotifyJson(request, `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, { method: "POST", headers, body: JSON.stringify({ uris: tracks.slice(index, index + 100) }) });
  }
  return { playlistUrl: playlist.external_urls.spotify, playlistId: playlist.id, trackCount: tracks.length, artistCount: artists.length, unresolved };
}
