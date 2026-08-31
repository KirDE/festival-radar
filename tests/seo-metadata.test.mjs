import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const seoSource = await readFile(new URL("../lib/seo.ts", import.meta.url), "utf8");
const sitemapSource = await readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8");

test("all indexable route classes define self-canonical metadata", async () => {
  const routes = [
    "festivals/[slug]", "artists/[slug]", "countries/[code]", "months/[month]",
    "archive", "submit", "[lang]",
  ];
  for (const route of routes) {
    const source = await readFile(new URL(`../app/${route}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /canonical/);
  }
});

test("sitemap uses content timestamps rather than future event dates", () => {
  assert.match(sitemapSource, /updatedAt/);
  assert.doesNotMatch(sitemapSource, /lastModified:\s*startDate/);
});

test("MusicEvent omits unknown facts and maps verified ticket state", () => {
  assert.match(seoSource, /item\.startDate \? \{ startDate/);
  assert.match(seoSource, /item\.ticketStatus === "available"/);
  assert.match(seoSource, /item\.ticketStatus === "unavailable"/);
  assert.match(seoSource, /https:\/\/schema\.org\/SoldOut/);
  assert.match(seoSource, /item\.ticketsUrl && availability/);
});
