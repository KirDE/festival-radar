import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const moduleUrl = new URL("../scripts/enrich-artists.mjs", import.meta.url);

test("artist enrichment script exposes operational safety controls", async () => {
  const source = await readFile(moduleUrl, "utf8");
  assert.match(source, /1100/);
  assert.match(source, /multiple_exact_matches/);
  assert.match(source, /manualReview/);
  assert.match(source, /\.tmp/);
  assert.doesNotMatch(source, /client.secret|api.key/i);
});

test("generated enrichment accounts for the complete current catalog", async () => {
  const [{ allArtists }, enrichment] = await Promise.all([
    import("../data/festivals.ts"),
    readFile(new URL("../data/artist-enrichment.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const handled = new Set([
    ...Object.keys(enrichment.profiles),
    ...enrichment.manualReview.map(({ slug }) => slug),
  ]);
  assert.equal(handled.size, allArtists.length);
  assert.equal(Object.keys(enrichment.profiles).length + enrichment.manualReview.length, allArtists.length);
  for (const profile of Object.values(enrichment.profiles)) {
    assert.ok(profile.identities.musicbrainz);
    assert.ok(profile.provenance.some(({ field, source, url }) => field === "identity" && source === "musicbrainz" && url.startsWith("https://musicbrainz.org/artist/")));
  }
});
