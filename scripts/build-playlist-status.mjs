import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const reportDir = process.argv[2] || "outputs/festival_playlists";
const outputFile = process.argv[3] || "data/playlist-status.json";
const youtubeReportDir = process.argv[4] || "outputs/youtube_music";

const status = {};
for (const filename of await readdir(reportDir).catch(() => [])) {
  if (!filename.endsWith(".json") || filename.endsWith("_summary.json")) continue;
  const key = filename.slice(0, -5);
  const report = JSON.parse(await readFile(path.join(reportDir, filename), "utf8"));
  const slug = typeof report.slug === "string" ? report.slug : key;
  const playlistUrl = typeof report.playlist_url === "string" ? report.playlist_url : undefined;
  if (!playlistUrl || !playlistUrl.startsWith("https://open.spotify.com/playlist/")) continue;
  status[slug] = {
    spotifyUrl: playlistUrl,
    artists: Number(report.artists_count) || 0,
    tracks: Number(report.track_count) || 0,
    updatedAt: report.generated_at || report.updated_at || new Date().toISOString(),
  };
}

for (const filename of await readdir(youtubeReportDir).catch(() => [])) {
  if (!filename.endsWith(".json") || filename.startsWith("_")) continue;
  const report = JSON.parse(await readFile(path.join(youtubeReportDir, filename), "utf8"));
  const slug = typeof report.slug === "string" ? report.slug : filename.slice(0, -5);
  const url = typeof report.playlist_url === "string" ? report.playlist_url : "";
  if (!/^https:\/\/music\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/.test(url)) continue;
  const current = status[slug] || {};
  status[slug] = { ...current, youtubeMusicUrl: url, artists: Number(report.artists_count) || current.artists || 0, tracks: Number(report.track_count) || current.tracks || 0, updatedAt: report.updated_at || current.updatedAt || new Date().toISOString() };
}

await writeFile(outputFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
console.log(`Wrote ${Object.keys(status).length} playlist statuses to ${outputFile}`);
