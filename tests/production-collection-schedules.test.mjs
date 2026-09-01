import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const jobs = ["artist-identities", "ingestion", "playlists", "source-monitor"];

test("collection workflows are manual-only", async () => {
  for (const job of jobs) {
    const workflow = await readFile(`.github/workflows/${job}.yml`, "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /\bschedule:/);
    assert.doesNotMatch(workflow, /\bcron:/);
  }
});

test("production installer owns every collection schedule", async () => {
  const [installer, runner, packager, deploy] = await Promise.all([
    readFile("scripts/deploy/install-release.sh", "utf8"),
    readFile("scripts/deploy/run-collection-job.sh", "utf8"),
    readFile("scripts/deploy/package-release.sh", "utf8"),
    readFile(".github/workflows/deploy.yml", "utf8"),
  ]);
  for (const job of jobs) {
    assert.match(installer, new RegExp(`install_collection_timer ${job}`));
    assert.match(runner, new RegExp(`${job}\\)`));
  }
  assert.match(installer, /Persistent=true/);
  assert.match(installer, /RandomizedDelaySec=300/);
  assert.match(installer, /COLLECTION_APP_URL=http:/);
  assert.match(runner, /app_url/);
  assert.match(runner, /api\/ingestion\/run/);
  assert.match(packager, /scripts\/spotify_gmm_2026\/\./);
  assert.match(packager, /spotify_gmm_2026\/spotify_auth\.py/);
  assert.match(packager, /python3 -m pip install[^\n]+--target[^\n]+\.python/);
  assert.match(deploy, /actions\/setup-python@v5/);
  assert.match(installer, /Environment=PYTHONPATH=\$app_root\/current\/\.python/);
  assert.match(installer, /Environment=PLAYLIST_PYTHON=python3/);
  assert.doesNotMatch(installer, /python3 -m venv|playlist-venv\/bin\/pip/);
  for (const name of ["SETLIST_API_KEY", "SPOTIFY_REFRESH_TOKEN"]) assert.match(deploy, new RegExp(name));
});
