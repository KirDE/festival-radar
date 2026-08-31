import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const workflowName of ["notifications", "ingestion"]) {
  test(`${workflowName} uses production-scoped internal API credentials`, async () => {
    const workflow = await readFile(`.github/workflows/${workflowName}.yml`, "utf8");
    assert.match(workflow, /jobs:[\s\S]*?environment: production/);
    assert.match(workflow, /APP_URL: \$\{\{ secrets\.APP_URL \}\}/);
    assert.match(workflow, /INTERNAL_API_SECRET: \$\{\{ secrets\.INTERNAL_API_SECRET \}\}/);
    assert.doesNotMatch(workflow, /INTERNAL_API_SECRET: \$\{\{ vars\./);
  });
}

test("notification scheduler posts to the canonical non-redirecting endpoint", async () => {
  const workflow = await readFile(".github/workflows/notifications.yml", "utf8");
  assert.match(workflow, /"\$\{APP_URL%\/\}\/api\/notifications\/dispatch\/"/);
  assert.doesNotMatch(workflow, /"\$APP_URL\/api\/notifications\/dispatch"/);
});

test("ingestion keeps database access inside production and uses the canonical internal endpoint", async () => {
  const workflow = await readFile(".github/workflows/ingestion.yml", "utf8");
  assert.doesNotMatch(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /"\$\{APP_URL%\/\}\/api\/ingestion\/run\/"/);
  assert.match(workflow, /mkdir -p outputs/);
  assert.match(workflow, /--argjson force "\$FORCE"/);
  assert.match(workflow, /jq -e '\.runId and \(\.summary\.attempted > 0\)[\s\S]*\.readBack\.attempts == \.summary\.attempted/);
  assert.match(workflow, /\.summary\.totalSources == 50[\s\S]*\.readBack\.diffs > 0[\s\S]*\.readBack\.hasPersistedFailure[\s\S]*\.readBack\.lastSuccessfulCheck/);
});

test("forced ingestion bypasses adaptive due filtering for full acceptance runs", async () => {
  const runner = await readFile("scripts/ingest-festivals.mjs", "utf8");
  assert.match(runner, /const force = args\.has\("--force"\)/);
  assert.match(runner, /const dueOnly = args\.has\("--due"\) && !force/);
  assert.match(runner, /const eligible = dueOnly \? dueFestivalSources/);
});

test("deployment requires and installs the internal API secret", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /INTERNAL_API_SECRET: \$\{\{ secrets\.INTERNAL_API_SECRET \}\}/);
  assert.match(workflow, /for name in DATABASE_URL AUTH_SECRET APP_URL INTERNAL_API_SECRET/);
  assert.match(workflow, /printf 'INTERNAL_API_SECRET=%q\\n' "\$INTERNAL_API_SECRET"/);
});

for (const routeName of ["events", "dispatch"]) {
  test(`${routeName} internal API route fails closed for unauthorized requests`, async () => {
    const route = await readFile(`app/api/notifications/${routeName}/route.ts`, "utf8");
    assert.match(route, /!process\.env\.INTERNAL_API_SECRET/);
    assert.match(route, /request\.headers\.get\("authorization"\) !== `Bearer \$\{process\.env\.INTERNAL_API_SECRET\}`/);
    assert.match(route, /return error\("Unauthorized\.", 401\)/);
  });
}

test("production ingestion route fails closed and invokes the persistent runner", async () => {
  const route = await readFile("app/api/ingestion/run/route.ts", "utf8");
  assert.match(route, /!process\.env\.INTERNAL_API_SECRET/);
  assert.match(route, /!process\.env\.DATABASE_URL/);
  assert.match(route, /Durable ingestion is unavailable\./);
  assert.match(route, /scripts\/ingest-festivals\.mjs/);
  assert.match(route, /--max-fetch-errors=10/);
  assert.match(route, /if \(parsed\.data\.force\) args\.push\("--force"\)/);
  assert.match(route, /cause\.code === 2/);
  assert.match(route, /persisted\.attempts\.length !== summary\.attempted/);
  assert.match(route, /lastSuccessfulCheck/);
});

test("standalone release contains the production-local ingestion runner", async () => {
  const packager = await readFile("scripts/deploy/package-release.sh", "utf8");
  assert.match(packager, /cp -a data lib/);
  assert.match(packager, /scripts\/ingest-festivals\.mjs/);
});
