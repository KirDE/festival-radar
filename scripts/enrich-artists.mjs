import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publishArtistEnrichment as publishPersistedEnrichment, exactArtistName, validateEnrichmentProfile } from "../lib/catalog/artist-enrichment-publication.ts";
import { boundedEnrichmentEvidence, migrateEnrichmentState } from "../lib/catalog/artist-enrichment-state.ts";
import { refreshSpotifyArtistStats, spotifyArtistFetcher } from "../lib/catalog/artist-spotify-stats.ts";
const userAgent = process.env.MUSICBRAINZ_USER_AGENT || "FestivalRadar/1.0 (https://github.com/KirDE/festival-radar)";
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function normalized(value) {
  return exactArtistName(value);
}

function chooseExact(name, artists) {
  const exact = artists.filter((artist) => [artist.name, ...(artist.aliases || []).map((alias) => alias.name)].some((candidate) => normalized(candidate) === normalized(name)));
  if (exact.length !== 1) return { match: null, reason: exact.length ? "multiple_exact_matches" : "no_exact_match" };
  return { match: exact[0], reason: null };
}

async function request(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try { response = await fetch(url, { headers: { accept: "application/json", "user-agent": userAgent }, signal: AbortSignal.timeout(30_000) }); }
    catch { if (attempt === attempts) throw new Error("source_unavailable"); await sleep(2 ** attempt * 1000); continue; }
    if (response.ok) return response.json();
    if (attempt === attempts || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`musicbrainz_http_${response.status}`);
    await sleep(2 ** attempt * 1000);
  }
}

function relationLinks(relations = []) {
  const allowed = new Map([["official homepage", "Official site"], ["social network", "Social profile"]]);
  return relations.flatMap((relation) => {
    const label = allowed.get(relation.type);
    const url = relation.url?.resource;
    let parsed;
    try { parsed = new URL(url); } catch { return []; }
    return label && parsed.protocol === "https:" && !parsed.username && !parsed.password ? [{ label, url, source: "official", verified: true }] : [];
  }).filter((item, index, links) => links.findIndex((candidate) => candidate.url === item.url) === index);
}

// Dependency injection exercises the real checkpoint/restart path without a network or DB.
export async function runEnrichment({ db, store, readArtists, refreshSpotify = async () => {}, fetchSearch = (name) => request(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:${name}`)}&fmt=json&limit=10`), publish: publishArtistEnrichment = publishPersistedEnrichment, pause = sleep, now = () => new Date() }) {
  // Retry durable publication before the daily gate, including flat imports.
  // The publisher reloads the locked payload; store.payload is only a claim snapshot.
  await publishArtistEnrichment(db, store);
  const state = migrateEnrichmentState(store.payload);
  const artists = await readArtists();
  if (artists.length > 1000) throw new Error("Enrichment catalog exceeds bound");
  const fingerprint = JSON.stringify(artists.map(({ slug, name }) => [slug, name]));
  const pendingEvidence = Object.keys(state.result?.profiles ?? {}).some((slug) => !state.cache?.[slug]);
  // Legacy receipts never establish that provider work completed.
  if (store.payload?.nextRunAt && state.nextRunAt && Date.parse(state.nextRunAt) > now().getTime() && !pendingEvidence && (!state.legacyImport || state.work?.complete) && (!state.work || (state.work.complete && state.work.fingerprint === fingerprint))) return;
  const resuming = state.work && !state.work.complete && state.work.fingerprint === fingerprint;
  const cache = resuming || !state.work ? { ...(state.cache ?? {}) } : {};
  const profiles = { ...(state.result?.profiles ?? {}), ...(state.profiles ?? {}) };
  const manualReview = [...(resuming || !state.work ? state.result?.manualReview ?? state.manualReview ?? [] : [])];
  const completed = new Set(resuming ? state.work.completed.filter((slug) => cache[slug]) : []);
  // A resumed run can cross a date boundary. New proof uses this invocation's
  // date; completed profiles keep the actual date of their earlier check.
  const generatedAt = now().toISOString();
  const checkedAt = generatedAt.slice(0, 10);
  // Retain prior receipt and immutable import on every save. The final publisher
  // reloads persisted evidence and revalidates it against the canonical name.
  const checkpoint = async (complete = false) => {
    const result = { schemaVersion: 1, generatedAt, source: "musicbrainz", profiles, manualReview };
    const work = { fingerprint, completed: [...completed], complete };
    const nextRunAt = complete ? new Date(now().getTime() + 86_400_000).toISOString() : null;
    boundedEnrichmentEvidence({ result, cache, legacyImport: state.legacyImport ?? null });
    await store.save({ ...state, cache, result, work, nextRunAt });
  };
  await checkpoint();
  let lastRequestAt = 0;
  for (const { name, slug: key } of artists) {
    if (completed.has(key)) continue;
    await refreshSpotify(key);
    // Remove retryable review when attempting this artist again.
    for (let i = manualReview.length - 1; i >= 0; i--) if (manualReview[i].slug === key) manualReview.splice(i, 1);
    let search = cache[key];
    if (!search) {
      const wait = Math.max(0, 1100 - (now().getTime() - lastRequestAt));
      if (wait) await pause(wait);
      try {
        search = await fetchSearch(name);
        boundedEnrichmentEvidence(search);
        cache[key] = search;
      } catch {
        // Never persist provider exception text: it can contain credentials.
        manualReview.push({ name, slug: key, reason: "source_unavailable" });
        await checkpoint();
        continue;
      } finally { lastRequestAt = now().getTime(); }
      // A crash here resumes from evidence, without another provider request.
      await checkpoint();
    }
    let profile;
    let reason;
    try {
      const selected = chooseExact(name, search.artists || []);
      if (!Number.isSafeInteger(search.count) || search.count < 0) reason = "unbounded_provider_search";
      else if (search.count > (search.artists || []).length) reason = "truncated_provider_search";
      else if (search.count < (search.artists || []).length) reason = "invalid_provider_count";
      else if (!selected.match) reason = selected.reason;
      else {
        const artist = selected.match;
        const sourceUrl = `https://musicbrainz.org/artist/${artist.id}`;
        profile = {
          identities: { musicbrainz: artist.id },
          ...(artist.area?.name || artist["begin-area"]?.name ? { origin: artist.area?.name || artist["begin-area"]?.name } : {}),
          genres: (artist.tags || []).filter(({ count = 0 }) => count > 0).sort((a, b) => b.count - a.count).slice(0, 5).map(({ name: tag }) => tag),
          links: relationLinks(artist.relations),
          provenance: [
            { field: "identity", source: "musicbrainz", url: sourceUrl, checkedAt },
            ...(artist.area?.name || artist["begin-area"]?.name ? [{ field: "origin", source: "musicbrainz", url: sourceUrl, checkedAt }] : []),
            ...((artist.tags || []).length ? [{ field: "genres", source: "musicbrainz", url: sourceUrl, checkedAt }] : []),
          ],
        };
        validateEnrichmentProfile(name, profile, search);
      }
    } catch { reason = "invalid_provider_evidence"; }
    if (reason) manualReview.push({ name, slug: key, reason });
    else profiles[key] = profile;
    completed.add(key);
    await checkpoint();
  }
  const complete = artists.every(({ slug }) => completed.has(slug));
  const result = { schemaVersion: 1, generatedAt, source: "musicbrainz", profiles, manualReview };
  const { cache: previousCache, result: previousResult, ...retained } = state;
  await store.save({ cache, result, ...retained, work: { fingerprint, completed: [...completed], complete }, nextRunAt: complete ? new Date(now().getTime() + 86_400_000).toISOString() : null });
  const publication = await publishArtistEnrichment(db, store);
  return { artists: artists.length, enriched: Object.keys(profiles).length, manualReview: manualReview.length, changed: publication?.changed ?? 0, complete };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { db } = await import("../lib/db.ts");
  const { readCatalog } = await import("../lib/catalog/repository.ts");
  const { claimOperationalState } = await import("../lib/catalog/operational-state.ts");
  let store;
  try {
    store = await claimOperationalState(db, "artist-enrichment");
    const fetchArtist = spotifyArtistFetcher();
    const summary = await runEnrichment({ db, store, refreshSpotify: (slug) => refreshSpotifyArtistStats({ db, lease: store, slug, fetchArtist }), readArtists: async () => (await readCatalog()).artists });
    if (summary) process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally { await store?.release(); await db.$disconnect(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // Suppress raw driver/network errors, which may include a credential-bearing URL.
  main().catch(() => { process.stderr.write("Artist enrichment failed; durable progress retained\n"); process.exitCode = 1; });
}
