import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

async function setup(html) {
  const dir = await mkdtemp(path.join(tmpdir(), "ingestion-"));
  await writeFile(path.join(dir, "fixture.html"), html);
  await writeFile(path.join(dir, "publications.json"), '{"schemaVersion":1,"festivals":{}}\n');
  return dir;
}
function run(dir, slug, publish = false) {
  const args = ["scripts/ingest-festivals.mjs", `--slug=${slug}`, `--fixture=${path.join(dir, "fixture.html")}`, `--publications=${path.join(dir, "publications.json")}`, `--history=${path.join(dir, "history.jsonl")}`, `--output=${path.join(dir, `out-${Date.now()}`)}`];
  if (publish) args.push("--publish");
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const safe = '<meta name="festival:city" content="Nürburg"><script type="application/ld+json">{"@type":"MusicEvent","startDate":"2027-06-04","endDate":"2027-06-06","performer":[{"name":"blink-182"},{"name":"New Safe Band"}]}</script>';

test("dry-run is observable and leaves overlay unchanged", async () => {
  const dir = await setup(safe); const summary = run(dir, "rock-am-ring");
  assert.equal(summary.dryRun, true); assert.equal(summary.published, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "publications.json"), "utf8")).festivals, {});
});
test("safe publication is durable, auditable and idempotent", async () => {
  const dir = await setup(safe); assert.equal(run(dir, "rock-am-ring", true).published, 1);
  assert.ok(JSON.parse(await readFile(path.join(dir, "publications.json"), "utf8")).festivals["rock-am-ring"].lineup.includes("New Safe Band"));
  const record = JSON.parse((await readFile(path.join(dir, "history.jsonl"), "utf8")).trim());
  assert.equal(record.sourceUrl, "https://www.rock-am-ring.com/"); assert.equal(record.outcome, "published");
  assert.equal(run(dir, "rock-am-ring", true).published, 0);
});
test("review-required removal is never published", async () => {
  const dir = await setup('<script type="application/ld+json">{"@type":"MusicEvent","startDate":"2027-07-28","endDate":"2027-07-31","performer":[{"name":"Electric Callboy"}]}</script>');
  assert.equal(run(dir, "wacken-open-air", true).published, 0);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "publications.json"), "utf8")).festivals, {});
});

test("policy-accepted source failure is reported as PARTIAL without failing downstream workflow", async () => {
  const dir = await setup(safe);
  const output = path.join(dir, "partial-output");
  const result = spawnSync(process.execPath, [
    "scripts/ingest-festivals.mjs",
    "--slug=rock-am-ring",
    `--fixture=${path.join(dir, "missing-fixture.html")}`,
    `--publications=${path.join(dir, "publications.json")}`,
    `--history=${path.join(dir, "history.jsonl")}`,
    `--output=${output}`,
    "--max-fetch-errors=1",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "PARTIAL");
  assert.equal(summary.totalSources, 1);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.processed, 0);
  assert.equal(summary.fetchErrors, 1);
  assert.equal(JSON.parse(await readFile(path.join(output, "summary.json"), "utf8")).status, "PARTIAL");
});

test("source failures above the explicit policy threshold remain fatal", async () => {
  const dir = await setup(safe);
  const result = spawnSync(process.execPath, [
    "scripts/ingest-festivals.mjs",
    "--slug=rock-am-ring",
    `--fixture=${path.join(dir, "missing-fixture.html")}`,
    `--publications=${path.join(dir, "publications.json")}`,
    `--history=${path.join(dir, "history.jsonl")}`,
    `--output=${path.join(dir, "failed-output")}`,
    "--max-fetch-errors=0",
  ], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, "FAILED");
  assert.equal(summary.fetchErrors, 1);
});

test("workflow keeps auditable publication and artifact handling after accepted partial runs", async () => {
  const workflow = await readFile(".github/workflows/ingestion.yml", "utf8");
  assert.match(workflow, /api\/ingestion\/run\//);
  assert.match(workflow, /summary\.status == "COMPLETED" or \.summary\.status == "PARTIAL"/);
  assert.match(workflow, /name: Retain review and diagnostic artifacts[\s\S]*if: always\(\)/);
});
