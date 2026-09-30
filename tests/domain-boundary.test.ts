import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Festival } from "../lib/domain/festival.ts";
import { festivalGenres, festivalMatchesDiscoveryFilters } from "../lib/festival-discovery.ts";

// A small, non-catalogue fixture: consumers can use the domain contract without
// loading the live festival data or its JSON overlays.
function makeFestival(overrides: Partial<Festival> = {}): Festival {
  return {
    slug: "synthetic-fest", name: "Synthetic Fest", country: "Germany", countryCode: "DE",
    headliners: [], lineup: [], officialUrl: "https://example.test/",
    status: "tba", ticketStatus: "unknown", updatedAt: "2026-01-01T00:00:00Z",
    genres: ["metal"], ...overrides,
  };
}

test("domain consumers work with a synthetic festival, independent of the seed", () => {
  const item = makeFestival({ genres: ["Doom Metal"], coordinates: { latitude: 52.52, longitude: 13.405 } });
  assert.deepEqual(festivalGenres([item]), ["doom metal"]);
  assert.equal(festivalMatchesDiscoveryFilters(item, { genre: "doom metal", origin: item.coordinates, maxDistanceKm: 1 }), true);
  assert.equal(festivalMatchesDiscoveryFilters(makeFestival(), { maxDistanceKm: 1, origin: item.coordinates }), false);
});

test("domain types and DB catalogue repository do not depend on live data modules", async () => {
  for (const file of ["festival", "edition", "artist"]) {
    const source = await readFile(new URL("../lib/domain/" + file + ".ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s*["'][^"']*data\//);
  }
  const repository = await readFile(new URL("../lib/catalog/repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(repository, /from\s*["'][^"']*data\//);
});
