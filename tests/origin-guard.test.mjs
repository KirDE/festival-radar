import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cookieAuthenticatedMutations = [
  "app/api/auth/logout/route.ts",
  "app/api/admin/route.ts",
  "app/api/admin/changes/[id]/route.ts",
  "app/api/admin/drafts/[id]/route.ts",
  "app/api/admin/refresh/[slug]/route.ts",
  "app/api/admin/submissions/[reference]/route.ts",
  "app/api/notifications/preferences/route.ts",
  "app/api/notifications/status/route.ts",
  "app/api/notifications/subscriptions/route.ts",
  "app/api/share/route.ts",
  "app/api/spotify/selection-playlist/route.ts",
  "app/api/spotify/sync/route.ts",
  "app/api/sync/[kind]/route.ts",
];

test("every cookie-authenticated mutation route rejects untrusted origins", async () => {
  for (const route of cookieAuthenticatedMutations) {
    const source = await readFile(route, "utf8");
    assert.match(source, /rejectUntrustedOrigin\(request\)/, route);
  }
});

test("bearer-authenticated production services keep their explicit non-browser boundary", async () => {
  for (const route of [
    "app/api/analytics/prune/route.ts",
    "app/api/ingestion/run/route.ts",
    "app/api/notifications/dispatch/route.ts",
    "app/api/notifications/events/route.ts",
  ]) {
    const source = await readFile(route, "utf8");
    assert.doesNotMatch(source, /rejectUntrustedOrigin/, route);
    assert.match(source, /authorization/i, route);
  }
});
