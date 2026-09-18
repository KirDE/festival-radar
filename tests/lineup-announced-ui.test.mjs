import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { announcedArtists, hasAnnouncedLineup, lineupPreviewArtists } from "../lib/festival-lineup.ts";

const lineupOnly = { headliners: [], lineup: ["VNV Nation", "The Sisters of Mercy"] };

test("lineup-only festivals count as announced and preview their published acts", () => {
  assert.equal(hasAnnouncedLineup(lineupOnly), true);
  assert.deepEqual(announcedArtists(lineupOnly), ["VNV Nation", "The Sisters of Mercy"]);
  assert.deepEqual(lineupPreviewArtists(lineupOnly), ["VNV Nation", "The Sisters of Mercy"]);
  assert.equal(hasAnnouncedLineup({ headliners: [], lineup: [] }), false);
});

test("headliners retain preview priority when official tiers are available", () => {
  const tiered = { headliners: ["Headliner"], lineup: ["Other act"] };
  assert.deepEqual(announcedArtists(tiered), ["Headliner", "Other act"]);
  assert.deepEqual(lineupPreviewArtists(tiered), ["Headliner"]);
});

test("all discovery surfaces use the complete announced lineup predicate", async () => {
  const [explorer, home, detail] = await Promise.all([
    readFile(new URL("../components/FestivalExplorer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/HomeContent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/FestivalDetail.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(explorer, /!announcedOnly \|\| hasAnnouncedLineup\(item\)/);
  assert.match(explorer, /const previewArtists = lineupPreviewArtists\(item\)/);
  assert.match(home, /festivals\.filter\(hasAnnouncedLineup\)/);
  assert.match(detail, /!hasArtists &&/);
  assert.doesNotMatch(`${explorer}\n${home}`, /headliners\.length > 0\)\.length|!announcedOnly \|\| item\.headliners\.length/);
});
