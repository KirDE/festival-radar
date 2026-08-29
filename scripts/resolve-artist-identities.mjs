import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { allArtists } from "../data/festivals.ts";

const spotifyCredentialsPath = process.env.SPOTIFY_CREDENTIALS_PATH;
const outputPath = process.argv[2] || "/tmp/festival-radar-artist-identity-candidates.json";

if (!spotifyCredentialsPath) throw new Error("SPOTIFY_CREDENTIALS_PATH is required");

const credentials = JSON.parse(await readFile(spotifyCredentialsPath, "utf8"));
const basic = Buffer.from(`${credentials.client_id}:${credentials.client_secret}`).toString("base64");
const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!tokenResponse.ok) throw new Error(`Spotify token request failed: ${tokenResponse.status}`);
const { access_token: spotifyToken } = await tokenResponse.json();

const normalize = (value) => value.normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const execFileAsync = promisify(execFile);

async function fetchWithRetry(url, options = {}, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === attempts) return response;
    await sleep(attempt * 2000);
  }
  throw new Error("unreachable");
}

async function musicBrainzJson(url) {
  const headers = { "User-Agent": "FestivalRadar/1.0 (https://github.com/KirDE/festival-radar)" };
  const response = await fetchWithRetry(url, { headers });
  if (response.ok) return response.json();

  // MusicBrainz occasionally rejects Node's transport while accepting the same
  // polite, rate-limited request over curl. Keep this fallback deterministic and
  // fail closed if either transport cannot return valid JSON.
  const { stdout } = await execFileAsync("curl", [
    "--fail", "--silent", "--show-error", "--retry", "5",
    "--retry-all-errors", "--retry-delay", "2", "--user-agent", headers["User-Agent"], url,
  ], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function spotifyCandidates(name) {
  const response = await fetchWithRetry(`https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${spotifyToken}` },
  });
  if (!response.ok) throw new Error(`Spotify search failed for ${name}: ${response.status}`);
  const payload = await response.json();
  return payload.artists.items.map((artist) => ({
    id: artist.id,
    name: artist.name,
    url: artist.external_urls.spotify,
    popularity: artist.popularity,
    exactName: normalize(artist.name) === normalize(name),
  }));
}

async function musicBrainzCandidates(name) {
  const payload = await musicBrainzJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:\"${name}\"`)}&limit=10&fmt=json`);
  const candidates = [];
  for (const artist of payload.artists || []) {
    if (normalize(artist.name) !== normalize(name) && !(artist.aliases || []).some((alias) => normalize(alias.name) === normalize(name))) continue;
    await sleep(1050);
    const detail = await musicBrainzJson(`https://musicbrainz.org/ws/2/artist/${artist.id}?inc=url-rels+aliases&fmt=json`);
    const spotifyUrls = (detail.relations || [])
      .map((relation) => relation.url?.resource)
      .filter((url) => /^https:\/\/open\.spotify\.com\/artist\/[A-Za-z0-9]{22}\/?$/.test(url || ""));
    candidates.push({
      id: artist.id,
      name: artist.name,
      disambiguation: artist.disambiguation || "",
      country: artist.country || null,
      score: artist.score,
      aliases: (detail.aliases || []).map((alias) => alias.name),
      spotifyUrls,
      url: `https://musicbrainz.org/artist/${artist.id}`,
      setlistFmUrl: `https://www.setlist.fm/setlists/${encodeURIComponent(artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}-${artist.id}.html`,
    });
  }
  return candidates;
}

let report = [];
try {
  const checkpoint = JSON.parse(await readFile(outputPath, "utf8"));
  if (!checkpoint.complete && Array.isArray(checkpoint.artists)) report = checkpoint.artists;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const completedNames = new Set(report.map((artist) => artist.name));
for (const [index, name] of allArtists.entries()) {
  if (completedNames.has(name)) continue;
  const spotify = await spotifyCandidates(name);
  await sleep(1050);
  const musicBrainz = await musicBrainzCandidates(name);
  const linked = musicBrainz.flatMap((candidate) => candidate.spotifyUrls.map((url) => ({
    musicBrainz: candidate,
    spotify: spotify.find((item) => item.url === url),
  }))).filter((pair) => pair.spotify);
  report.push({
    name,
    status: linked.length === 1 ? "linked" : linked.length > 1 ? "ambiguous" : "unresolved",
    linked,
    spotify,
    musicBrainz,
  });
  await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), complete: false, artists: report }, null, 2)}\n`);
  process.stderr.write(`[${index + 1}/${allArtists.length}] ${name}: ${report.at(-1).status}\n`);
}

await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), complete: true, artists: report }, null, 2)}\n`);
console.log(outputPath);
