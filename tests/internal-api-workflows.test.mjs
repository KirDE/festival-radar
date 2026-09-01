import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

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
  assert.match(workflow, /scripts\/validate-ingestion-response\.jq/);
});

test("ingestion workflow validates scoped and full-catalogue responses independently", async () => {
  const validate = async (response, festival, force = true) => {
    const directory = await mkdtemp(path.join(tmpdir(), "ingestion-validation-"));
    const responsePath = path.join(directory, "response.json");
    try {
      await writeFile(responsePath, JSON.stringify(response));
      const { stdout } = await execute("jq", [
        "-e",
        "--arg", "festival", festival,
        "--argjson", "force", String(force),
        "-f", "scripts/validate-ingestion-response.jq",
        responsePath,
      ]);
      return stdout.trim();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  const scoped = {
    runId: "scoped-run",
    summary: {
      status: "COMPLETED", totalSources: 1, attempted: 1,
      results: [{ festivalSlug: "pinkpop", extractionPath: ["official_markup"], evidenceFields: ["startDate"] }],
    },
    readBack: { attempts: 1, candidates: 1, evidence: 1, diffs: 0, hasPersistedFailure: false, lastSuccessfulCheck: "2026-08-31T16:34:00Z" },
  };
  assert.equal(await validate(scoped, "pinkpop"), "true");
  await assert.rejects(validate({ ...scoped, summary: { ...scoped.summary, results: [{ ...scoped.summary.results[0], extractionPath: [] }] } }, "pinkpop"));

  const full = {
    runId: "full-run",
    summary: { status: "PARTIAL", totalSources: 50, attempted: 50, results: [] },
    readBack: { attempts: 50, candidates: 48, evidence: 55, diffs: 108, hasPersistedFailure: true, lastSuccessfulCheck: "2026-08-31T10:46:50Z" },
  };
  assert.equal(await validate(full, ""), "true");
  await assert.rejects(validate({ ...full, readBack: { ...full.readBack, diffs: 0 } }, ""));
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
  assert.match(workflow, /for name in DATABASE_URL AUTH_SECRET APP_URL ADMIN_EMAILS INTERNAL_API_SECRET/);
  assert.match(workflow, /printf 'INTERNAL_API_SECRET=%q\\n' "\$INTERNAL_API_SECRET"/);
});

test("deployment preserves the protected admin allowlist", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /ADMIN_EMAILS: \$\{\{ secrets\.ADMIN_EMAILS \}\}/);
  assert.match(workflow, /for name in DATABASE_URL AUTH_SECRET APP_URL ADMIN_EMAILS INTERNAL_API_SECRET/);
  assert.match(workflow, /printf 'ADMIN_EMAILS=%q\\n' "\$ADMIN_EMAILS"/);
  assert.doesNotMatch(workflow, /echo.*ADMIN_EMAILS/);
});

test("deployment builds and installs the privacy analytics contract", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  const pruneWorkflow = await readFile(".github/workflows/prune-analytics.yml", "utf8");
  assert.match(workflow, /NEXT_PUBLIC_ANALYTICS_ENDPOINT: \/api\/analytics\/page-view\//);
  assert.match(workflow, /ANALYTICS_OPERATOR_TOKEN: \$\{\{ secrets\.ANALYTICS_OPERATOR_TOKEN \}\}/);
  assert.match(workflow, /ANALYTICS_RETENTION_TOKEN: \$\{\{ secrets\.ANALYTICS_RETENTION_TOKEN \}\}/);
  assert.match(workflow, /printf 'ANALYTICS_OPERATOR_TOKEN=%q\\n'/);
  assert.match(workflow, /printf 'ANALYTICS_RETENTION_DAYS=%q\\n'/);
  assert.match(pruneWorkflow, /environment: production/);
  assert.doesNotMatch(pruneWorkflow, /schedule:/);
  assert.match(pruneWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(pruneWorkflow, /DATABASE_URL/);
  assert.match(pruneWorkflow, /ANALYTICS_RETENTION_TOKEN: \$\{\{ secrets\.ANALYTICS_RETENTION_TOKEN \}\}/);
  assert.match(pruneWorkflow, /\/api\/analytics\/prune\//);
});

test("analytics retention route fails closed behind its dedicated secret", async () => {
  const route = await readFile("app/api/analytics/prune/route.ts", "utf8");
  assert.match(route, /!token \|\| request\.headers\.get\("authorization"\) !== `Bearer \$\{token\}`/);
  assert.match(route, /pruneAnalytics\(db, process\.env\.ANALYTICS_RETENTION_DAYS\)/);
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
