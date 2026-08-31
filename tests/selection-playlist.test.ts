import assert from "node:assert/strict";
import test from "node:test";
import { createSelectionPlaylist, deduplicateArtists } from "../lib/selection-playlist.ts";
import { parsePlannerState, serializePlannerState } from "../lib/planner-storage.ts";

test("deduplicates artist names case-insensitively and preserves order", () => {
  assert.deepEqual(deduplicateArtists([" Ghost ", "ghost", "Gojira", ""]), ["Ghost", "Gojira"]);
});

test("creates one playlist and adds a deduplicated track payload", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/search?")) return Response.json({ tracks: { items: [{ uri: url.includes("Ghost") ? "spotify:track:ghost" : "spotify:track:gojira" }] } });
    if (url.includes("/users/")) return Response.json({ id: "playlist-id", external_urls: { spotify: "https://open.spotify.com/playlist/playlist-id" } });
    return Response.json({ snapshot_id: "snapshot" });
  };
  const result = await createSelectionPlaylist({ token: "test", spotifyUserId: "user", artists: ["Ghost", "ghost", "Gojira"], festivals: ["Wacken"], request });
  assert.equal(result.playlistUrl, "https://open.spotify.com/playlist/playlist-id");
  assert.equal(result.trackCount, 2);
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), { uris: ["spotify:track:ghost", "spotify:track:gojira"] });
});

test("fails before creating an empty playlist when every artist is unresolved", async () => {
  await assert.rejects(() => createSelectionPlaylist({ token: "test", spotifyUserId: "user", artists: ["Unknown"], festivals: ["Test"], request: async () => Response.json({ tracks: { items: [] } }) }), /could not resolve/);
});

test("persists selected festival slugs in local planner storage", () => {
  const state = { favoriteFestivals: [], favoriteArtists: [], attendance: {}, playlistFestivals: ["wacken-open-air", "graspop"] };
  assert.deepEqual(parsePlannerState(serializePlannerState(state)).playlistFestivals, state.playlistFestivals);
});
