import assert from "node:assert/strict";
import { test } from "node:test";
import { festivals } from "../data/festivals.ts";
import { distanceKm, festivalGenres, festivalMatchesDiscoveryFilters } from "../lib/festival-discovery.ts";

test("all production festivals have normalized genres and venue coordinates", () => {
  for (const item of festivals) {
    assert.ok(item.genres.length > 0, `${item.name} needs a genre`);
    assert.deepEqual(item.genres, item.genres.map((genre) => genre.trim().toLowerCase()));
    assert.ok(item.coordinates, `${item.name} needs coordinates`);
    assert.ok(Math.abs(item.coordinates.latitude) <= 90);
    assert.ok(Math.abs(item.coordinates.longitude) <= 180);
  }
});

test("genre filtering uses exact normalized genre values", () => {
  const roadburn = festivals.find(({ slug }) => slug === "roadburn");
  assert.ok(roadburn);
  assert.equal(festivalMatchesDiscoveryFilters(roadburn, { genre: "  Doom   Metal " }), true);
  assert.equal(festivalMatchesDiscoveryFilters(roadburn, { genre: "power metal" }), false);
  assert.ok(festivalGenres(festivals).includes("doom metal"));
});

test("distance filtering uses documented origin and festival coordinates", () => {
  const berlin = { latitude: 52.52, longitude: 13.405 };
  const wacken = festivals.find(({ slug }) => slug === "wacken-open-air");
  const madrid = festivals.find(({ slug }) => slug === "mad-cool");
  assert.ok(wacken?.coordinates && madrid?.coordinates);
  assert.ok(distanceKm(berlin, wacken.coordinates) > 250 && distanceKm(berlin, wacken.coordinates) < 350);
  assert.equal(festivalMatchesDiscoveryFilters(wacken, { origin: berlin, maxDistanceKm: 500 }), true);
  assert.equal(festivalMatchesDiscoveryFilters(madrid, { origin: berlin, maxDistanceKm: 500 }), false);
});

test("distance filtering fails closed when location data is unavailable", () => {
  const item = { ...festivals[0], coordinates: undefined };
  assert.equal(festivalMatchesDiscoveryFilters(item, { origin: { latitude: 0, longitude: 0 }, maxDistanceKm: 100 }), false);
});
