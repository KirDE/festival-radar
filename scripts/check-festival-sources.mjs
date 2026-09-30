import { db } from "../lib/db.ts";
import { listConfiguredSources } from "../lib/sources/repository.ts";

// No repository fallback: an unavailable or unconfigured database is a failed
// monitor, not a reason to check obsolete file URLs.
if (!process.env.DATABASE_URL) throw new Error("Database-backed source monitor unavailable");
let sources;
try { sources = await listConfiguredSources(db); }
catch { throw new Error("Configured source load failed"); }
if (!sources.length || !sources.some((source) => source.enabled)) throw new Error("No configured database sources");
let checked = 0;
let reviewRequired = 0;
let restricted = 0;
for (let index = 0; index < sources.length; index += 5) {
  const batch = sources.slice(index, index + 5).filter((source) => source.enabled);
  await Promise.all(batch.map(async (source) => {
    checked++;
    try {
      const response = await fetch(source.fetchUrl ?? source.url, {
        redirect: "follow", signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "FestivalRadar/1.0 (+https://festivals.kir-it.de)", ...source.headers },
      });
      if (response.status === 404 || response.status === 410 || response.status >= 500) reviewRequired++;
      else if (response.status === 401 || response.status === 403 || response.status === 429) restricted++;
    } catch { reviewRequired++; }
  }));
}
let setlist = "skipped";
if (process.env.SETLIST_API_KEY) {
  try {
    const response = await fetch("https://api.setlist.fm/rest/1.0/search/artists?artistName=Metallica&p=1&sort=relevance", {
      headers: { Accept: "application/json", "x-api-key": process.env.SETLIST_API_KEY },
      signal: AbortSignal.timeout(20_000),
    });
    setlist = response.ok ? "ok" : "review-required";
  } catch { setlist = "review-required"; }
}
console.log(JSON.stringify({ status: reviewRequired || setlist === "review-required" ? "REVIEW_REQUIRED" : "OK", checked, reviewRequired, restricted, setlist }));
if (reviewRequired || setlist === "review-required") process.exitCode = 1;
await db.$disconnect();
