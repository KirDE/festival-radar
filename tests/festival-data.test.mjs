import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { festivals } from "../data/festivals.ts";
import { artistProfiles } from "../data/artists.ts";
import { festivalSources } from "../data/festival-sources.ts";
import { INGESTION_SCHEMA_VERSION } from "../lib/ingestion/types.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

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

test("the production deploy smoke uses an existing artist profile", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  const match = workflow.match(/festivals\.kir-it\.de\/artists\/([a-z0-9-]+)\//);

  assert.ok(match, "deploy workflow must smoke-test an artist route");
  assert.ok(artistProfiles.some(({ slug }) => slug === match[1]), match[1]);
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

test("every festival has exactly one enabled ingestion source", () => {
  assert.equal(festivalSources.length, festivals.length);
  assert.equal(new Set(festivalSources.map(({ festivalSlug }) => festivalSlug)).size, festivals.length);
  assert.deepEqual(festivalSources.map(({ festivalSlug }) => festivalSlug).sort(), festivals.map(({ slug }) => slug).sort());
  for (const source of festivalSources) {
    assert.match(source.url, /^https:\/\//);
    assert.equal(source.enabled, true);
    assert.ok(source.strategies.length > 0);
    assert.ok(["daily", "every_3_days", "weekly"].includes(source.refreshPolicy));
  }
});

test("safe additions can publish while removals and empty replacements require review", () => {
  const current = festivals.find(({ slug }) => slug === "wacken-open-air");
  assert.ok(current);
  const base = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: current.slug,
    sourceUrl: current.officialUrl,
    fetchedAt: "2026-08-28T20:00:00.000Z",
    evidence: [],
    warnings: [],
  };
  const addition = evaluateCandidate(current, { ...base, lineup: [...current.lineup, "Test Artist"] });
  assert.equal(addition.publishable, true);
  assert.equal(addition.changes.at(-1)?.kind, "artist_added");
  const removal = evaluateCandidate(current, { ...base, lineup: current.lineup.slice(1) });
  assert.equal(removal.publishable, false);
  assert.ok(removal.changes.some(({ kind }) => kind === "artist_removed"));
  const empty = evaluateCandidate(current, { ...base, lineup: [] });
  assert.equal(empty.publishable, false);
  assert.ok(empty.reviewReasons.some((reason) => reason.includes("empty lineup")));
});
