import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("builds public status only for valid known Spotify reports", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "festival-playlist-status-"));
  await writeFile(path.join(dir, "wacken_2026.json"), JSON.stringify({
    playlist_url: "https://open.spotify.com/playlist/example",
    artists_count: 80,
    track_count: 240,
    generated_at: "2026-08-28T20:00:00Z",
  }));
  await writeFile(path.join(dir, "unknown.json"), JSON.stringify({ playlist_url: "https://example.test" }));
  const output = path.join(dir, "status.json");
  const result = spawnSync(process.execPath, ["scripts/build-playlist-status.mjs", dir, output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
    "wacken-open-air": {
      spotifyUrl: "https://open.spotify.com/playlist/example",
      artists: 80,
      tracks: 240,
      updatedAt: "2026-08-28T20:00:00Z",
    },
  });
});
