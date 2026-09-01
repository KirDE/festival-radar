/* Festival Radar public-only service worker. Bump DATA_VERSION when the offline payload changes. */
const CACHE_VERSION = "festival-radar-public-v2";
const DATA_VERSION = "festivals-2027-v1";
const MAX_ENTRIES = 80;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_PAGE = "/offline.html";
const PRECACHE = [
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  `/offline/${DATA_VERSION}.json`,
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
    url.pathname.startsWith("/offline/") ||
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

async function precache(cache) {
  await Promise.all(PRECACHE.map(async (url) => {
    const response = await fetch(url, { cache: "reload" });
    if (!cacheable(response)) throw new Error(`Unable to precache ${url}: HTTP ${response.status}`);
    await cache.put(url, await stamped(response));
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then(precache).then(() => self.skipWaiting()));
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
  if (!sameOrigin(url) || isPrivatePath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(request)) || (await caches.match(OFFLINE_PAGE)) || Response.error()));
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
