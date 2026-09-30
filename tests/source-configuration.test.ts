import assert from "node:assert/strict";
import test from "node:test";
import { festivalSources } from "../data/festival-sources.ts";
import { sourceParserKey, validateSource } from "../lib/sources/repository.ts";

const source = festivalSources.find((item) => item.festivalSlug === "2000trees")!;
test("inventory parser keys are registered and source options survive", () => {
  for (const item of festivalSources) assert.ok(validateSource(item));
  assert.equal(sourceParserKey(source), "official_markup:2000trees");
  assert.equal(festivalSources.find((item) => item.festivalSlug === "rock-for-people")!.fetchUrl, "https://rockforpeople.cz/lineup/");
  for (const slug of ["tons-of-rock", "midgardsblot"]) assert.ok(festivalSources.find((item) => item.festivalSlug === slug)!.followLinkPattern);
  assert.equal(festivalSources.find((item) => item.festivalSlug === "metaldays")!.enabled, false);
  assert.ok(festivalSources.some((item) => item.strategies.includes("manual_review")));
});
test("configuration rejects unknown parser, invalid URL, regex and edition", () => {
  assert.throws(() => validateSource({ ...source, parserKey: "unknown" }), /parser key/);
  assert.throws(() => validateSource({ ...source, festivalSlug: "unknown" }), /Unknown official parser/);
  assert.throws(() => validateSource({ ...source, url: "file:///tmp/test" }), /URL/);
  assert.throws(() => validateSource({ ...source, fetchUrl: "https://user:pass@example.test/" }), /URL/);
  assert.throws(() => validateSource({ ...source, followLinkPattern: "(" }), /regex/);
  assert.throws(() => validateSource({ ...source, followLinkPattern: "^(a+)+$" }), /regex/);
  assert.throws(() => validateSource({ ...source, editionYear: 0 }), /edition/);
});
