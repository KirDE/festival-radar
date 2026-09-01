import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runnerPath = path.resolve("scripts/analytics/prune-production.sh");

async function runWithResponse(body, status = "200") {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-retention-"));
  const bin = path.join(directory, "bin");
  const runtime = path.join(directory, "run");
  await mkdir(bin);
  await mkdir(runtime);
  const curl = path.join(bin, "curl");
  await writeFile(curl, `#!/usr/bin/env bash\nset -euo pipefail\noutput=""\nwhile (($#)); do\n  if [[ "$1" == --output ]]; then output="$2"; shift 2; else shift; fi\ndone\nprintf '%s' '${body}' > "$output"\nprintf '%s' '${status}'\n`);
  await chmod(curl, 0o755);
  const stateFile = path.join(directory, "state.json");
  const result = spawnSync("bash", [runnerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      NODE_BINARY: process.execPath,
      ANALYTICS_RETENTION_TOKEN: "test-only-token",
      ANALYTICS_RETENTION_STATE_FILE: stateFile,
      ANALYTICS_RETENTION_LOCK_FILE: path.join(runtime, "prune.lock"),
    },
  });
  return { result, state: JSON.parse(await readFile(stateFile, "utf8")) };
}

test("production owns analytics retention scheduling and GitHub is manual diagnostics only", async () => {
  const [installer, workflow, runner, packager, deploy] = await Promise.all([
    readFile("scripts/deploy/install-release.sh", "utf8"),
    readFile(".github/workflows/prune-analytics.yml", "utf8"),
    readFile("scripts/analytics/prune-production.sh", "utf8"),
    readFile("scripts/deploy/package-release.sh", "utf8"),
    readFile(".github/workflows/deploy.yml", "utf8"),
  ]);

  assert.match(installer, /OnCalendar=\*-\*-\* 03:17:00 UTC/);
  assert.match(installer, /Persistent=true/);
  assert.match(installer, /ANALYTICS_RETENTION_APP_URL=http:\/\/127\.0\.0\.1:\$port/);
  assert.match(installer, /systemctl enable --now "\$service-analytics-retention.timer"/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(runner, /flock -n/);
  assert.match(runner, /authorization: Bearer \$ANALYTICS_RETENTION_TOKEN/);
  assert.match(runner, /--write-out '%\{http_code\}'/);
  assert.match(runner, /\[\[ "\$http_status" == 2\?\? \]\]/);
  assert.match(runner, /deletedAggregateRows/);
  assert.doesNotMatch(runner, /ANALYTICS_RETENTION_TOKEN.*state_file/);
  assert.match(packager, /scripts\/analytics\/prune-production\.sh/);
  assert.match(deploy, /ANALYTICS_RETENTION_STATE_FILE/);
});

test("production retention runner persists a successful validated read-back", async () => {
  const { result, state } = await runWithResponse('{"deletedAggregateRows":2,"cutoff":"2026-06-03T00:00:00.000Z","retentionDays":90}');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state.ok, true);
  assert.equal(state.deletedAggregateRows, 2);
  assert.equal(state.cutoff, "2026-06-03T00:00:00.000Z");
  assert.equal(state.retentionDays, 90);
});

test("production retention runner fails closed and records HTTP failure without secrets", async () => {
  const { result, state } = await runWithResponse('{"error":"Unauthorized."}', "401");
  assert.equal(result.status, 1);
  assert.equal(state.ok, false);
  assert.doesNotMatch(JSON.stringify(state), /test-only-token/);
});

test("production retention runner rejects malformed success responses", async () => {
  const { result, state } = await runWithResponse('{"deletedAggregateRows":-1,"cutoff":"invalid","retentionDays":0}');
  assert.equal(result.status, 1);
  assert.equal(state.ok, false);
  assert.match(result.stderr, /invalid analytics retention response/);
});
