/* Festival Radar public-only service worker. DB catalogue freshness uses its ETag. */
const CACHE_VERSION = "festival-radar-public-v4";
const CATALOG = "/api/offline/catalog";
const MAX_ENTRIES = 80;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_PAGE = "/offline.html";
const PRECACHE = [
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function isPrivatePath(pathname) {
  return pathname.startsWith("/api/") ||
    pathname === "/login" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/sync") ||
    pathname.startsWith("/share") ||
    pathname.startsWith("/notifications");
}

function isPublicAsset(url) {
  return url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/logos/") ||
    url.pathname === "/manifest.webmanifest";
}

function cacheable(response) {
  if (!response || response.status !== 200 || response.type === "opaque") return false;
  const control = response.headers.get("cache-control") || "";
  return !/no-store|private/i.test(control) && !response.headers.has("set-cookie");
}

async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set("x-festival-radar-cached-at", String(Date.now()));
  return new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function freshCached(cache, request) {
  const response = await cache.match(request);
  if (!response) return undefined;
  const storedAt = Number(response.headers.get("x-festival-radar-cached-at"));
  if (!storedAt || Date.now() - storedAt > MAX_AGE_MS) {
    await cache.delete(request);
    return undefined;
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key);
}

function publicCatalogHeaders(response) {
  const control = response.headers.get("cache-control") || "";
  const revision = response.headers.get("x-catalog-revision");
  const vary = response.headers.get("vary") || "";
  return /(?:^|,)\s*public\s*(?:,|$)/i.test(control) &&
    !/no-store|private/i.test(control) && !response.headers.has("set-cookie") &&
    !/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(vary) &&
    !response.redirected && response.type !== "opaque" &&
    /^[a-f0-9]{64}$/.test(revision || "") && response.headers.get("etag") === `"${revision}"`;
}

async function usableCatalog(response) {
  if (!response || response.status !== 200 || !publicCatalogHeaders(response) ||
      !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")) return false;
  try {
    const body = await response.clone().json();
    return body.schemaVersion === 1 && body.editionYear === 2027 &&
      Array.isArray(body.festivals) && body.festivals.length > 0;
  } catch { return false; }
}

async function catalogResponse() {
  // Cache Storage may be unavailable (quota/privacy settings). First fetch must still work.
  const cache = await caches.open(CACHE_VERSION).catch(() => undefined);
  let cached;
  if (cache) {
    try {
      const candidate = await freshCached(cache, CATALOG);
      if (await usableCatalog(candidate)) cached = candidate;
      else if (candidate) await cache.delete(CATALOG);
    } catch { /* Fetch unconditionally if storage cannot be read. */ }
  }
  // Next's trailingSlash configuration redirects the bare API path. Fetch its canonical URL.
  const request = (etag) => new Request(new URL(`${CATALOG}/`, self.location.origin), {
    credentials: "omit", cache: "no-store", redirect: "error",
    headers: { Accept: "application/json", ...(etag ? { "If-None-Match": etag } : {}) },
  });
  const save = async (response) => {
    if (cache) {
      try { await cache.put(CATALOG, await stamped(response)); await trim(cache); }
      catch { /* A successful network response remains usable even when storage fails. */ }
    }
    return response;
  };
  let response;
  try {
    response = await fetch(request(cached?.headers.get("etag")));
    if (response.status === 304) {
      if (cached && publicCatalogHeaders(response) &&
          response.headers.get("etag") === cached.headers.get("etag")) return save(cached);
      // Never expose a bodyless 304 to JSON consumers or accept a mismatched revision.
      response = await fetch(request());
    }
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
  if (response.status === 304) return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  if (await usableCatalog(response)) await save(response);
  return response;
}

async function precache(cache) {
  await Promise.all(PRECACHE.map(async (url) => {
    const response = await fetch(url, { cache: "reload" });
    if (!cacheable(response)) throw new Error(`Unable to precache ${url}: HTTP ${response.status}`);
    await cache.put(url, await stamped(response));
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then(precache)
    // DB unavailability must not prevent the existing static offline shell installing.
    .then(() => catalogResponse().catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (sameOrigin(url) && (url.pathname === CATALOG || url.pathname === `${CATALOG}/`) &&
      !url.search && request.mode !== "navigate" &&
      !request.headers?.has("authorization") && !request.headers?.has("cookie")) {
    event.respondWith(catalogResponse());
    return;
  }
  if (!sameOrigin(url) || isPrivatePath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_VERSION);
      const page = await cache.match(OFFLINE_PAGE);
      return cacheable(page) ? page : Response.error();
    }));
    return;
  }

  if (!isPublicAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await freshCached(cache, request);
    if (cached) return cached;
    const response = await fetch(request);
    if (cacheable(response)) {
      await cache.put(request, await stamped(response));
      await trim(cache);
    }
    return response;
  })());
});

// Intentionally available only for deterministic VM tests; ignored by browsers.
if (typeof module !== "undefined") module.exports = { sameOrigin, isPrivatePath, isPublicAsset, cacheable };
