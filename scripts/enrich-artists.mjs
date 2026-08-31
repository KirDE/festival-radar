import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { allArtists, artistSlug } from "../data/festivals.ts";

const outputPath = resolve(process.env.ARTIST_ENRICHMENT_OUTPUT || "data/artist-enrichment.json");
const cachePath = resolve(process.env.ARTIST_ENRICHMENT_CACHE || "tmp/artist-enrichment-cache.json");
const checkedAt = new Date().toISOString().slice(0, 10);
const userAgent = process.env.MUSICBRAINZ_USER_AGENT || "FestivalRadar/1.0 (https://github.com/KirDE/festival-radar)";
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalized(value) {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase("en");
}

function chooseExact(name, artists) {
  const exact = artists.filter((artist) => [artist.name, ...(artist.aliases || []).map((alias) => alias.name)].some((candidate) => normalized(candidate) === normalized(name)));
  if (exact.length !== 1) return { match: null, reason: exact.length ? "multiple_exact_matches" : "no_exact_match" };
  return { match: exact[0], reason: null };
}

async function request(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": userAgent } });
    if (response.ok) return response.json();
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`${url}: HTTP ${response.status}`);
    await sleep(2 ** attempt * 1000);
  }
}

function relationLinks(relations = []) {
  const allowed = new Map([["official homepage", "Official site"], ["social network", "Social profile"]]);
  return relations.flatMap((relation) => {
    const label = allowed.get(relation.type);
    const url = relation.url?.resource;
    return label && /^https:\/\//.test(url || "") ? [{ label, url, source: "official", verified: true }] : [];
  }).filter((item, index, links) => links.findIndex((candidate) => candidate.url === item.url) === index);
}

async function main() {
  const cache = await readJson(cachePath, {});
  const profiles = {};
  const manualReview = [];
  let lastRequestAt = 0;
  for (const name of allArtists) {
    const key = artistSlug(name);
    let search = cache[key];
    if (!search) {
      const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
      if (wait) await sleep(wait);
      try {
        search = await request(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:${name}`)}&fmt=json&limit=10`);
      } catch (error) {
        manualReview.push({ name, slug: key, reason: "source_unavailable", error: String(error.message || error) });
        continue;
      }
      lastRequestAt = Date.now();
      cache[key] = search;
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    }
    const selected = chooseExact(name, search.artists || []);
    if (!selected.match) {
      manualReview.push({ name, slug: key, reason: selected.reason, candidateIds: (search.artists || []).slice(0, 3).map(({ id }) => id) });
      continue;
    }
    const artist = selected.match;
    const sourceUrl = `https://musicbrainz.org/artist/${artist.id}`;
    profiles[key] = {
      identities: { musicbrainz: artist.id, setlistFm: artist.id },
      origin: artist.area?.name || artist["begin-area"]?.name || undefined,
      genres: (artist.tags || []).filter(({ count = 0 }) => count > 0).sort((a, b) => b.count - a.count).slice(0, 5).map(({ name: tag }) => tag),
      links: relationLinks(artist.relations),
      provenance: [
        { field: "identity", source: "musicbrainz", url: sourceUrl, checkedAt },
        ...(artist.area?.name || artist["begin-area"]?.name ? [{ field: "origin", source: "musicbrainz", url: sourceUrl, checkedAt }] : []),
        ...((artist.tags || []).length ? [{ field: "genres", source: "musicbrainz", url: sourceUrl, checkedAt }] : []),
      ],
    };
  }
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: "musicbrainz", profiles, manualReview };
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`);
  await rename(temporary, outputPath);
  process.stdout.write(`${JSON.stringify({ artists: allArtists.length, enriched: Object.keys(profiles).length, manualReview: manualReview.length })}\n`);
}

await main();
