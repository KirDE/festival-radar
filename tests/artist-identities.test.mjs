import test from "node:test";
import assert from "node:assert/strict";
import { classify, dueArtists, dueEnrichment, freshState } from "../scripts/resolve-artist-identities.mjs";

test("aliases and homonyms fail closed unless one direct cross-provider relation matches", () => {
  const spotify = [{ id: "correct", name: "Alias", url: "https://open.spotify.com/artist/1234567890123456789012" }];
  const candidates = [{ id: "one", name: "Canonical", aliases: ["Alias"], spotifyUrls: [spotify[0].url] }, { id: "homonym", name: "Alias", aliases: [], spotifyUrls: [] }];
  assert.equal(classify("Alias", spotify, candidates).status, "linked");
  candidates[1].spotifyUrls = [spotify[0].url];
  assert.equal(classify("Alias", spotify, candidates).status, "ambiguous");
  assert.equal(classify("Unknown", spotify, []).status, "unresolved");
});

test("checkpoint scheduling skips completed and backs-off retryable artists", () => {
  const state = freshState(["done", "deferred", "next"]);
  state.artists.done.base.status = "linked";
  state.artists.deferred.base.status = "retryable";
  state.artists.deferred.base.nextAttemptAt = "2030-01-01T00:00:00.000Z";
  assert.deepEqual(dueArtists(state, Date.parse("2029-01-01T00:00:00.000Z"), 10).map((item) => item.name), ["next"]);
  state.artists.done.base.status = "complete";
  assert.deepEqual(dueEnrichment(state, Date.parse("2029-01-01T00:00:00.000Z"), 10).map((item) => item.name), ["done"]);
});
