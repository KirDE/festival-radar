import assert from "node:assert/strict";
import { test } from "node:test";
import { festivals } from "../data/festivals.ts";
import { artistProfiles } from "../data/artists.ts";

test("the seed contains 50 unique festivals", () => {
  assert.equal(festivals.length, 50);
  assert.equal(new Set(festivals.map(({ slug }) => slug)).size, 50);
});

test("dated editions have valid chronological dates", () => {
  for (const festival of festivals) {
    if (!festival.startDate) continue;
    assert.match(festival.startDate, /^2027-\d{2}-\d{2}$/);
    assert.ok((festival.endDate || festival.startDate) >= festival.startDate, festival.name);
  }
});

test("official links are HTTPS", () => {
  for (const festival of festivals) assert.match(festival.officialUrl, /^https:\/\//, festival.name);
});

test("every lineup name has one unambiguous artist profile", () => {
  assert.ok(artistProfiles.length > 0);
  assert.equal(new Set(artistProfiles.map(({ slug }) => slug)).size, artistProfiles.length);
  for (const artist of artistProfiles) {
    assert.ok(artist.name);
    assert.ok(artist.links.some(({ source }) => source === "spotify"));
    assert.ok(artist.links.some(({ source }) => source === "musicbrainz"));
    assert.ok(artist.links.some(({ source }) => source === "setlist.fm"));
  }
});

test("curated identities include provenance and stable provider IDs", () => {
  const curated = artistProfiles.filter(({ identities }) => Object.keys(identities).length > 0);
  assert.ok(curated.length >= 3);
  for (const artist of curated) {
    assert.match(artist.identities.spotify, /^[A-Za-z0-9]{22}$/);
    assert.match(artist.identities.musicbrainz, /^[0-9a-f-]{36}$/);
    assert.equal(artist.identities.setlistFm, artist.identities.musicbrainz);
    assert.ok(artist.provenance.length >= 3);
  }
});
