import { readFile, writeFile, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { allArtists } from "../data/festivals.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) => value.normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
const execFileAsync = promisify(execFile);
const retryableStatus = (status) => status === 429 || status >= 500;

export function freshState(names = allArtists) {
  return { schemaVersion: 1, updatedAt: null, artists: Object.fromEntries(names.map((name) => [name, { name, status: "unresolved", base: { status: "pending", attempts: 0 }, enrichment: { status: "pending", attempts: 0 } }])) };
}

export function dueArtists(state, now = Date.now(), limit = 20) {
  return Object.values(state.artists).filter((artist) => ["pending", "retryable"].includes(artist.base.status) && (!artist.base.nextAttemptAt || Date.parse(artist.base.nextAttemptAt) <= now)).slice(0, limit);
}

export function dueEnrichment(state, now = Date.now(), limit = 20) {
  return Object.values(state.artists).filter((artist) => artist.base.status === "complete" && ["pending", "retryable"].includes(artist.enrichment.status) && (!artist.enrichment.nextAttemptAt || Date.parse(artist.enrichment.nextAttemptAt) <= now)).slice(0, limit);
}

export function classify(name, spotify, musicBrainz) {
  const linked = musicBrainz.flatMap((candidate) => candidate.spotifyUrls.map((url) => ({ musicBrainz: candidate, spotify: spotify.find((item) => item.url === url) }))).filter((pair) => pair.spotify);
  return { name, status: linked.length === 1 ? "linked" : linked.length > 1 ? "ambiguous" : "unresolved", linked, spotify, musicBrainz };
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function requestJson(url, options = {}, attempts = 4) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      lastStatus = response.status;
      if (response.ok) return response.json();
      if (!retryableStatus(response.status)) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt === attempts) break;
    }
    await sleep(attempt * 1000);
  }
  if (url.startsWith("https://musicbrainz.org/")) {
    const { stdout } = await execFileAsync("curl", ["--fail", "--silent", "--show-error", "--retry", "3", "--retry-all-errors", "--retry-delay", "2", "--user-agent", options.headers?.["User-Agent"], url], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  throw new Error(`retryable HTTP ${lastStatus || "transport"}`);
}

async function spotifyToken(credentialsPath) {
  const credentials = credentialsPath
    ? JSON.parse(await readFile(credentialsPath, "utf8"))
    : { client_id: process.env.SPOTIFY_CLIENT_ID, client_secret: process.env.SPOTIFY_CLIENT_SECRET };
  if (!credentials.client_id || !credentials.client_secret) throw new Error("Spotify client credentials are required");
  const basic = Buffer.from(`${credentials.client_id}:${credentials.client_secret}`).toString("base64");
  const payload = await requestJson("https://accounts.spotify.com/api/token", { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  return payload.access_token;
}

async function resolveBase(name, token) {
  const spotifyPayload = await requestJson(`https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
  const spotify = spotifyPayload.artists.items.map((artist) => ({ id: artist.id, name: artist.name, url: artist.external_urls.spotify, popularity: artist.popularity, exactName: normalize(artist.name) === normalize(name) }));
  await sleep(1100);
  const headers = { "User-Agent": "FestivalRadar/1.0 (https://github.com/KirDE/festival-radar)" };
  const payload = await requestJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:\"${name}\"`)}&limit=10&fmt=json`, { headers });
  const musicBrainz = (payload.artists || []).filter((artist) => normalize(artist.name) === normalize(name)).map((artist) => ({ id: artist.id, name: artist.name, disambiguation: artist.disambiguation || "", score: artist.score, spotifyUrls: [], url: `https://musicbrainz.org/artist/${artist.id}` }));
  // Base search is deliberately cheap. Relationship enrichment is a separate phase.
  return { spotify, musicBrainz };
}

async function enrich(candidate) {
  const headers = { "User-Agent": "FestivalRadar/1.0 (https://github.com/KirDE/festival-radar)" };
  const detail = await requestJson(`https://musicbrainz.org/ws/2/artist/${candidate.id}?inc=url-rels+aliases&fmt=json`, { headers });
  return { ...candidate, aliases: (detail.aliases || []).map((alias) => alias.name), spotifyUrls: (detail.relations || []).map((relation) => relation.url?.resource).filter((url) => /^https:\/\/open\.spotify\.com\/artist\/[A-Za-z0-9]{22}\/?$/.test(url || "")) };
}

export async function run({ statePath, credentialsPath, limit = 20, now = Date.now() }) {
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; state = freshState(); }
  const token = await spotifyToken(credentialsPath);
  for (const artist of dueArtists(state, now, limit)) {
    artist.base.attempts += 1;
    try {
      const base = await resolveBase(artist.name, token);
      artist.candidates = base;
      artist.base.status = "complete";
      delete artist.base.nextAttemptAt;
      artist.status = "unresolved";
    } catch (error) {
      artist.status = "retryable";
      artist.base.status = "retryable";
      artist.base.lastError = String(error.message).slice(0, 300);
      artist.base.nextAttemptAt = new Date(now + Math.min(24, 2 ** artist.base.attempts) * 60 * 60 * 1000).toISOString();
    }
    state.updatedAt = new Date().toISOString();
    await atomicWrite(statePath, state);
  }
  for (const artist of dueEnrichment(state, now, limit)) {
    artist.enrichment.attempts += 1;
    try {
      const enriched = [];
      for (const candidate of artist.candidates.musicBrainz) { await sleep(1100); enriched.push(await enrich(candidate)); }
      artist.enrichment.status = "complete";
      delete artist.enrichment.nextAttemptAt;
      Object.assign(artist, classify(artist.name, artist.candidates.spotify, enriched));
    } catch (error) {
      artist.status = "retryable";
      artist.enrichment.status = "retryable";
      artist.enrichment.lastError = String(error.message).slice(0, 300);
      artist.enrichment.nextAttemptAt = new Date(now + Math.min(24, 2 ** artist.enrichment.attempts) * 60 * 60 * 1000).toISOString();
    }
    state.updatedAt = new Date().toISOString();
    await atomicWrite(statePath, state);
  }
  return state;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const statePath = process.env.IDENTITY_STATE_PATH || process.argv[2] || "outputs/artist-identities/state.json";
  const credentialsPath = process.env.SPOTIFY_CREDENTIALS_PATH;
  const state = await run({ statePath, credentialsPath, limit: Number(process.env.IDENTITY_BATCH_SIZE || 20) });
  console.log(JSON.stringify({ statePath, updatedAt: state.updatedAt, counts: Object.values(state.artists).reduce((counts, artist) => ({ ...counts, [artist.status]: (counts[artist.status] || 0) + 1 }), {}) }));
}
