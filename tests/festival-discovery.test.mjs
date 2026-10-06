import assert from "node:assert/strict";
import { test } from "node:test";
import { festival } from "./support/catalog.ts";
const festivals = [festival];
import { distanceKm, festivalGenres, festivalMatchesDiscoveryFilters } from "../lib/festival-discovery.ts";

test("genre filtering uses exact normalized genre values", () => {
  const roadburn = festival;
  assert.ok(roadburn);
  assert.equal(festivalMatchesDiscoveryFilters(roadburn, { genre: "  Doom   Metal " }), true);
  assert.equal(festivalMatchesDiscoveryFilters(roadburn, { genre: "power metal" }), false);
  assert.ok(festivalGenres(festivals).includes("doom metal"));
});

test("distance filtering uses documented origin and festival coordinates", () => {
  const berlin = { latitude: 0, longitude: 0 };
  const wacken = { ...festival, coordinates: { latitude: 0, longitude: 3 } };
  const madrid = { ...festival, coordinates: { latitude: 0, longitude: 30 } };
  assert.ok(wacken?.coordinates && madrid?.coordinates);
  assert.ok(distanceKm(berlin, wacken.coordinates) > 330 && distanceKm(berlin, wacken.coordinates) < 340);
  assert.equal(festivalMatchesDiscoveryFilters(wacken, { origin: berlin, maxDistanceKm: 500 }), true);
  assert.equal(festivalMatchesDiscoveryFilters(madrid, { origin: berlin, maxDistanceKm: 500 }), false);
});

test("distance filtering fails closed when location data is unavailable", () => {
  const item = { ...festivals[0], coordinates: undefined };
  assert.equal(festivalMatchesDiscoveryFilters(item, { origin: { latitude: 0, longitude: 0 }, maxDistanceKm: 100 }), false);
});
