import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
const execute = promisify(execFile);

test("workflow keeps auditable publication and artifact handling after accepted partial runs", async () => {
  const workflow = await readFile(".github/workflows/ingestion.yml", "utf8");
  const validation = await readFile("scripts/validate-ingestion-response.jq", "utf8");
  assert.match(workflow, /api\/ingestion\/run\//);
  assert.match(validation, /summary\.status == "COMPLETED" or \.summary\.status == "PARTIAL"/);
  assert.match(workflow, /name: Retain review and diagnostic artifacts[\s\S]*if: always\(\)/);
});


test("ingestion requires DB-backed sources even with explicit local HTML", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ingestion-no-db-"));
  const output = path.join(dir, "output");
  const fixture = path.join(dir, "fixture.html");
  try {
    await writeFile(fixture, "<h1>Synthetic festival</h1>");
    for (const fixtureArgs of [[], [`--fixture=${fixture}`]]) {
      await assert.rejects(execute(process.execPath, ["scripts/ingest-festivals.mjs", `--output=${output}`, ...fixtureArgs], {
        env: { ...process.env, DATABASE_URL: "" },
      }), error => /Database-backed sources require DATABASE_URL/.test(error.stderr));
      await assert.rejects(readFile(path.join(output, "summary.json"), "utf8"), { code: "ENOENT" });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
