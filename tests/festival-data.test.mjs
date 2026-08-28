import assert from "node:assert/strict";
import { test } from "node:test";
import { festivals } from "../data/festivals.ts";

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
