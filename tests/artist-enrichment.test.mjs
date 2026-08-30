import assert from "node:assert/strict";
import { test } from "node:test";

const moduleUrl = new URL("../scripts/enrich-artists.mjs", import.meta.url);

test("artist enrichment script exposes operational safety controls", async () => {
  const source = await (await import("node:fs/promises")).readFile(moduleUrl, "utf8");
  assert.match(source, /1100/);
  assert.match(source, /multiple_exact_matches/);
  assert.match(source, /manualReview/);
  assert.match(source, /\.tmp/);
  assert.doesNotMatch(source, /client.secret|api.key/i);
});
