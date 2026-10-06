import assert from "node:assert/strict";
import test from "node:test";
import { parserSource } from "./support/parser-source.ts";
import { validateSource } from "../lib/sources/repository.ts";

const source = parserSource("2000trees");
test("source options validate without a repository inventory", () => {
  assert.equal(validateSource(source), "official_markup:2000trees");
  assert.equal(validateSource(parserSource("synthetic", { strategies: ["json_ld_event", "html_fallback"], fetchUrl: "https://feed.example.test/", headers: { "x-test": "fixture" }, followLinkPattern: "^/news/[a-z]+/$" })), "json_ld_event+html_fallback");
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
