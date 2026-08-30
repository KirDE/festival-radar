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
