import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { festivals } from "../data/festivals.ts";
import { artistProfiles } from "../data/artists.ts";
import { festivalSources } from "../data/festival-sources.ts";
import { INGESTION_SCHEMA_VERSION } from "../lib/ingestion/types.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";
import { hasAvailableTickets, ticketPresentation } from "../lib/tickets.ts";
import { festivalLogoFallbacks, festivalLogoPath } from "../data/festival-logos.ts";

test("the seed contains 50 unique festivals", () => {
  assert.equal(festivals.length, 50);
  assert.equal(new Set(festivals.map(({ slug }) => slug)).size, 50);
});

test("every emitted local festival logo URL exists", async () => {
  const fallbackNames = [];
  for (const festival of festivals) {
    const logoPath = festivalLogoPath(festival.slug);
    if (!logoPath) {
      fallbackNames.push(festival.slug);
      continue;
    }
    assert.match(logoPath, /^\/logos\/[a-z0-9-]+\.png$/);
    await access(new URL(`../public${logoPath}`, import.meta.url));
  }
  assert.deepEqual(fallbackNames.sort(), [...festivalLogoFallbacks].sort());
  assert.deepEqual(fallbackNames.sort(), ["bloodstock", "brutal-assault", "metaldays", "pistoia-blues", "polandrock"]);
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

test("ticket availability is normalized and available tickets have verified HTTPS URLs", () => {
  for (const festival of festivals) {
    assert.ok(["available", "unavailable", "unknown"].includes(festival.ticketStatus), festival.name);
    if (festival.ticketStatus === "available") {
      assert.match(festival.ticketsUrl, /^https:\/\//, festival.name);
    } else {
      assert.equal(festival.ticketsUrl, undefined, `${festival.name} must not expose an unverified ticket URL`);
    }
  }
});

test("ticket UI distinguishes available, unavailable and unknown without homepage fallback", () => {
  const available = festivals.find(({ slug }) => slug === "rock-am-ring");
  const unavailable = festivals.find(({ slug }) => slug === "pinkpop");
  const unknown = festivals.find(({ slug }) => slug === "rock-im-park");
  assert.ok(available && unavailable && unknown);

  assert.deepEqual(ticketPresentation(available), {
    status: "available",
    href: "https://www.rock-am-ring.com/en/tickets",
    label: "officialTickets",
  });
  assert.deepEqual(ticketPresentation(unavailable), { status: "unavailable", label: "ticketsUnavailable" });
  assert.deepEqual(ticketPresentation(unknown), { status: "unknown", label: "ticketsUnknown" });
  assert.equal(hasAvailableTickets(available), true);
  assert.equal(hasAvailableTickets(unavailable), false);
  assert.equal(hasAvailableTickets(unknown), false);
  assert.notEqual(unavailable.officialUrl, ticketPresentation(unavailable).href);
  assert.notEqual(unknown.officialUrl, ticketPresentation(unknown).href);
});

test("every lineup name has one explicit artist identity state", () => {
  assert.ok(artistProfiles.length > 0);
  assert.equal(new Set(artistProfiles.map(({ slug }) => slug)).size, artistProfiles.length);
  for (const artist of artistProfiles) {
    assert.ok(artist.name);
    assert.match(artist.identityState, /^(linked|ambiguous|unresolved|retryable)$/);
    assert.ok(artist.freshness.profile.refreshAfter > artist.freshness.profile.checkedAt);
    assert.ok(artist.freshness.music.cadenceDays <= 14);
    assert.ok(artist.freshness.setlists.cadenceDays <= 7);
  }
});

test("only verified artist links are identity evidence and enriched records are accessible", () => {
  const enriched = artistProfiles.filter((artist) => artist.biography || artist.image || artist.recentSetlists.length);
  const partial = artistProfiles.filter((artist) => !artist.biography && !artist.image && artist.recentSetlists.length === 0);
  assert.ok(enriched.length >= 3);
  assert.ok(partial.length > 0);
  for (const artist of artistProfiles) {
    for (const item of artist.provenance.filter(({ field }) => field === "identity")) {
      assert.ok(artist.links.some((link) => link.source === item.source && link.url === item.url && link.verified));
    }
    if (artist.image) {
      assert.ok(artist.image.alt.includes(artist.name));
      assert.ok(artist.image.width > 0 && artist.image.height > 0);
    }
    for (const setlist of artist.recentSetlists) {
      assert.match(setlist.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(setlist.url, /^https:\/\/www\.setlist\.fm\//);
    }
  }
});

test("resolved identities include provenance and stable provider IDs", () => {
  const resolved = artistProfiles.filter(({ identities }) => identities.musicbrainz);
  assert.ok(resolved.length > 3);
  for (const artist of resolved) {
    if (artist.identities.spotify) assert.match(artist.identities.spotify, /^[A-Za-z0-9]{22}$/);
    assert.match(artist.identities.musicbrainz, /^[0-9a-f-]{36}$/);
    assert.equal(artist.identities.setlistFm, artist.identities.musicbrainz);
    assert.ok(artist.provenance.some(({ field, source }) => field === "identity" && source === "musicbrainz"));
  }
});

test("the production deploy smoke uses an existing artist profile", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  const match = workflow.match(/festivals\.kir-it\.de\/artists\/([a-z0-9-]+)\//);

  assert.ok(match, "deploy workflow must smoke-test an artist route");
  assert.ok(artistProfiles.some(({ slug }) => slug === match[1]), match[1]);
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
    observedEditionYears: [2027],
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
