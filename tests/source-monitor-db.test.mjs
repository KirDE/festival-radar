import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("source monitor has no file fallback or raw source error output", async () => {
  const script = await readFile("scripts/check-festival-sources.mjs", "utf8");
  assert.match(script, /listConfiguredSources\(db\)/);
  assert.doesNotMatch(script, /data\/festivals|data\/festival-sources|officialUrl/);
  assert.doesNotMatch(script, /error\.message|source\.url\}/);
  const result = spawnSync(process.execPath, ["scripts/check-festival-sources.mjs"], {
    env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Database-backed source monitor unavailable/);
});

test("manual monitor uses protected production route, not stale repository URLs", async () => {
  const workflow = await readFile(".github/workflows/source-monitor.yml", "utf8");
  const route = await readFile("app/api/source-monitor/run/route.ts", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /api\/source-monitor\/run\//);
  assert.doesNotMatch(workflow, /npm run check:sources|DATABASE_URL/);
  assert.match(route, /INTERNAL_API_SECRET/);
  assert.match(route, /!process\.env\.DATABASE_URL/);
  assert.doesNotMatch(route, /data\/festival-sources|data\/festivals/);
});
