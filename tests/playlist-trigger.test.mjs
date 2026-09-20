import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function runScript(script, ...payloads) {
  const directory = await mkdtemp(path.join(tmpdir(), "playlist-trigger-"));
  try {
    const paths = [];
    for (const [index, payload] of payloads.entries()) {
      const target = path.join(directory, `${index}.json`);
      await writeFile(target, JSON.stringify(payload));
      paths.push(target);
    }
    return (await execute(process.execPath, [script, ...paths])).stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("selects only uniquely published ingestion festivals", async () => {
  const response = { summary: { published: 3, playlistRefreshRequested: 2, results: [
    { festivalSlug: "rock-im-park", outcome: "published", playlistRefreshRequested: true },
    { festivalSlug: "wacken-open-air", outcome: "published", playlistRefreshRequested: false },
    { festivalSlug: "rock-am-ring", outcome: "published", playlistRefreshRequested: true },
  ] } };
  assert.equal(await runScript("scripts/select-published-festivals.mjs", response), "rock-am-ring,rock-im-park");
});

test("rejects inconsistent ingestion publication counts", async () => {
  const response = { summary: { published: 1, playlistRefreshRequested: 1, results: [] } };
  await assert.rejects(runScript("scripts/select-published-festivals.mjs", response), /playlist refresh count mismatch/);
});

test("detects only publication lineup and headliner changes", async () => {
  const before = { festivals: { a: { lineup: ["One"], ticketsUrl: "old" }, b: { headliners: ["Two"] } } };
  const after = { festivals: { a: { lineup: ["One"], ticketsUrl: "new" }, b: { headliners: ["Two", "Three"] }, c: { lineup: ["Four"] } } };
  assert.equal(await runScript("scripts/changed-publication-lineups.mjs", before, after), "b,c");
});
