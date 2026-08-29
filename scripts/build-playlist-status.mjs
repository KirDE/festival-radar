import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const reportDir = process.argv[2] || "outputs/festival_playlists";
const outputFile = process.argv[3] || "data/playlist-status.json";
const slugByReport = {
  graspop_2026: "graspop",
  rock_im_park_2026: "rock-im-park",
  summer_breeze_2026: "summer-breeze",
  wacken_2026: "wacken-open-air",
};

const status = {};
for (const filename of await readdir(reportDir).catch(() => [])) {
  if (!filename.endsWith(".json") || filename.endsWith("_summary.json")) continue;
  const key = filename.slice(0, -5);
  const slug = slugByReport[key];
  if (!slug) continue;
  const report = JSON.parse(await readFile(path.join(reportDir, filename), "utf8"));
  const playlistUrl = typeof report.playlist_url === "string" ? report.playlist_url : undefined;
  if (!playlistUrl || !playlistUrl.startsWith("https://open.spotify.com/playlist/")) continue;
  status[slug] = {
    spotifyUrl: playlistUrl,
    artists: Number(report.artists_count) || 0,
    tracks: Number(report.track_count) || 0,
    updatedAt: report.generated_at || report.updated_at || new Date().toISOString(),
  };
}

await writeFile(outputFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
console.log(`Wrote ${Object.keys(status).length} playlist statuses to ${outputFile}`);
