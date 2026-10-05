import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWorker({ fetchImpl, cachesImpl } = {}) {
  const listeners = {};
  const context = {
    module: { exports: {} }, URL, Headers, Request, Response, Blob,
    fetch: fetchImpl || (() => Promise.reject(new TypeError("offline"))),
    caches: cachesImpl || { open: async () => ({ match: async () => new Response("offline") }) },
    self: {
      location: { origin: "https://festivals.test" },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
      addEventListener: (name, fn) => { listeners[name] = fn; },
    },
  };
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  return { helpers: context.module.exports, listeners };
}

test("install stamps every precache entry and serves the versioned payload offline", async () => {
  const entries = new Map();
  const cacheKey = (key) => new URL(typeof key === "string" ? key : key.url, "https://festivals.test").pathname;
  const cache = {
    put: async (key, response) => entries.set(cacheKey(key), response),
    match: async (key) => entries.get(cacheKey(key)),
    delete: async (key) => entries.delete(cacheKey(key)),
    keys: async () => [...entries.keys()],
  };
  const caches = { open: async () => cache, match: cache.match, keys: async () => [], delete: async () => true };
  const { listeners } = await loadWorker({
    cachesImpl: caches,
    fetchImpl: async (request) => new Response(String(request).includes(".json") ? '{"festivals":[]}' : "asset", { status: 200 }),
  });
  let install;
  listeners.install({ waitUntil: (promise) => { install = promise; } });
  await install;

  for (const response of entries.values()) {
    assert.ok(Number(response.headers.get("x-festival-radar-cached-at")) > 0);
  }

  let offlineResponse;
  listeners.fetch({
    request: { method: "GET", url: "https://festivals.test/offline/festivals-2027-v1.json", mode: "cors" },
    respondWith: (promise) => { offlineResponse = promise; },
  });
  assert.deepEqual(await (await offlineResponse).json(), { festivals: [] });
  for (const path of ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]) {
    assert.ok(await cache.match(path), `${path} remains available offline`);
  }
});

test("private/user APIs and authenticated routes are never cache candidates", async () => {
  const { helpers } = await loadWorker();
  for (const path of ["/api/auth/me", "/api/sync", "/account", "/admin/review", "/notifications"]) assert.equal(helpers.isPrivatePath(path), true);
  assert.equal(helpers.isPublicAsset(new URL("https://festivals.test/api/auth/me")), false);
});

test("only same-origin allowlisted, successful public responses are cacheable", async () => {
  const { helpers } = await loadWorker();
  assert.equal(helpers.sameOrigin(new URL("https://cdn.example/icon.png")), false);
  assert.equal(helpers.isPublicAsset(new URL("https://festivals.test/_next/static/app.js")), true);
  assert.equal(helpers.cacheable(new Response("missing", { status: 404 })), false);
  assert.equal(helpers.cacheable(new Response("error", { status: 500 })), false);
  assert.equal(helpers.cacheable(new Response("private", { status: 200, headers: { "cache-control": "private" } })), false);
  assert.equal(helpers.cacheable(new Response("ok", { status: 200, headers: { "content-type": "text/css" } })), true);
});

test("offline fallback is navigation-only; API and ordinary assets are not type-confused", async () => {
  const { listeners } = await loadWorker();
  let navigationResponse;
  listeners.fetch({ request: { method: "GET", url: "https://festivals.test/festivals/wacken", mode: "navigate" }, respondWith: (value) => { navigationResponse = value; } });
  assert.ok(navigationResponse instanceof Promise);
  let apiIntercepted = false;
  listeners.fetch({ request: { method: "GET", url: "https://festivals.test/api/auth/me", mode: "cors" }, respondWith: () => { apiIntercepted = true; } });
  assert.equal(apiIntercepted, false);
  let unknownAssetIntercepted = false;
  listeners.fetch({ request: { method: "GET", url: "https://festivals.test/private.pdf", mode: "cors" }, respondWith: () => { unknownAssetIntercepted = true; } });
  assert.equal(unknownAssetIntercepted, false);
});

const CATALOG_URL = "https://festivals.test/api/offline/catalog";
const revisionA = "a".repeat(64);
const revisionB = "b".repeat(64);
const payload = (name = "Festival A") => ({
  schemaVersion: 1, dataVersion: "festivals-2027-v1", editionYear: 2027,
  generatedAt: null, timetableStatus: "not-published",
  festivals: [{ slug: "festival-a", name, startDate: null, endDate: null, timetable: [] }],
});
function catalogReply(revision = revisionA, { status = 200, headers = {}, body = payload() } = {}) {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate, no-transform",
    ETag: `"${revision}"`, "X-Catalog-Revision": revision, ...headers,
  } });
}
function memoryCache() {
  const entries = new Map();
  const keyOf = (key) => new URL(typeof key === "string" ? key : key.url, "https://festivals.test").href;
  const cache = {
    put: async (key, response) => { entries.set(keyOf(key), response.clone()); },
    match: async (key) => entries.get(keyOf(key))?.clone(),
    delete: async (key) => entries.delete(keyOf(key)),
    keys: async () => [...entries.keys()],
  };
  return { cache, caches: { open: async () => cache, keys: async () => [], delete: async () => true } };
}
function dispatch(listeners, request = new Request(CATALOG_URL)) {
  let result;
  listeners.fetch({ request, respondWith: (response) => { result = response; } });
  return result;
}
async function seed(cache, response = catalogReply(), storedAt = Date.now()) {
  const headers = new Headers(response.headers);
  headers.set("x-festival-radar-cached-at", String(storedAt));
  await cache.put(CATALOG_URL, new Response(await response.text(), { status: response.status, headers }));
}

test("initial catalogue fetch is unconditional, anonymous, and saves a body for network failure", async () => {
  const { cache, caches } = memoryCache();
  let online = true;
  const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
    assert.equal(request.url, `${CATALOG_URL}/`);
    assert.equal(request.credentials, "omit");
    assert.equal(request.cache, "no-store");
    assert.equal(request.redirect, "error");
    if (!online) throw new TypeError("offline");
    assert.equal(request.headers.get("if-none-match"), null);
    return catalogReply();
  } });
  // A caller's validator must not cause a bodyless initial response.
  const first = await dispatch(listeners, new Request(CATALOG_URL, { headers: { "If-None-Match": "*" } }));
  assert.deepEqual(await first.json(), payload());
  assert.ok(await cache.match(CATALOG_URL));
  online = false;
  assert.deepEqual(await (await dispatch(listeners)).json(), payload());
});

test("initial offline catalogue request fails without substituting static JSON or HTML", async () => {
  const { caches } = memoryCache();
  const { listeners } = await loadWorker({ cachesImpl: caches });
  await assert.rejects(dispatch(listeners), /offline/);
});

test("matching 304 returns the saved JSON body and refreshes its retention stamp", async () => {
  const { cache, caches } = memoryCache();
  const oldStamp = Date.now() - 60000;
  await seed(cache, catalogReply(), oldStamp);
  const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
    assert.equal(request.headers.get("if-none-match"), `"${revisionA}"`);
    return catalogReply(revisionA, { status: 304 });
  } });
  const response = await dispatch(listeners);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload());
  assert.ok(Number((await cache.match(CATALOG_URL)).headers.get("x-festival-radar-cached-at")) > oldStamp);
});

test("a new revision replaces body and validator; a subsequent offline request uses it", async () => {
  const { cache, caches } = memoryCache();
  await seed(cache);
  let online = true;
  const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
    if (!online) throw new TypeError("offline");
    assert.equal(request.headers.get("if-none-match"), `"${revisionA}"`);
    return catalogReply(revisionB, { body: payload("Festival B") });
  } });
  assert.deepEqual(await (await dispatch(listeners)).json(), payload("Festival B"));
  assert.equal((await cache.match(CATALOG_URL)).headers.get("etag"), `"${revisionB}"`);
  online = false;
  assert.deepEqual(await (await dispatch(listeners)).json(), payload("Festival B"));
});

test("304 without a cached body or with a mismatched revision retries unconditionally", async () => {
  for (const existing of [false, true]) {
    const { cache, caches } = memoryCache();
    if (existing) await seed(cache);
    const requests = [];
    const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
      requests.push(request);
      return requests.length === 1 ? catalogReply(revisionB, { status: 304 }) : catalogReply(revisionB);
    } });
    assert.deepEqual(await (await dispatch(listeners)).json(), payload());
    assert.equal(requests.length, 2);
    assert.equal(requests[1].headers.get("if-none-match"), null);
  }
});

test("repeated bodyless 304 becomes an uncacheable error, never JSON success", async () => {
  const { cache, caches } = memoryCache();
  const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async () => catalogReply(revisionA, { status: 304 }) });
  const response = await dispatch(listeners);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await cache.match(CATALOG_URL), undefined);
});

test("expired, malformed and private cached bodies cannot validate or fall back", async () => {
  const candidates = [
    [catalogReply(), Date.now() - 8 * 24 * 60 * 60 * 1000],
    [catalogReply(revisionA, { headers: { "Cache-Control": "private" } })],
    [catalogReply(revisionA, { body: { user: "private" } })],
    [new Response("not json", { headers: catalogReply().headers })],
  ];
  for (const [candidate, stamp] of candidates) {
    const { cache, caches } = memoryCache();
    await seed(cache, candidate, stamp);
    const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
      assert.equal(request.headers.get("if-none-match"), null);
      throw new TypeError("offline");
    } });
    await assert.rejects(dispatch(listeners), /offline/);
    assert.equal(await cache.match(CATALOG_URL), undefined);
  }
});

test("unsafe network responses are never saved and HTTP errors do not become stale success", async () => {
  for (const options of [
    { headers: { "Cache-Control": "private" } },
    { headers: { "Cache-Control": "no-store" } },
    { headers: { "Cache-Control": "max-age=0" } },
    { headers: { "Set-Cookie": "session=secret" } },
    { headers: { Vary: "Cookie" } },
    { headers: { Vary: "Authorization" } },
    { headers: { Vary: "*" } },
    { headers: { "Content-Type": "text/html" } },
    { headers: { ETag: `"${revisionB}"` } },
    { status: 401 }, { status: 503 },
  ]) {
    const { cache, caches } = memoryCache();
    let online = true;
    const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async () => {
      if (!online) throw new TypeError("offline");
      return catalogReply(revisionA, options);
    } });
    assert.equal((await dispatch(listeners)).status, options.status || 200);
    assert.equal(await cache.match(CATALOG_URL), undefined);
    online = false;
    await assert.rejects(dispatch(listeners), /offline/);
  }
});

test("the catalogue exception is exact and excludes auth headers, queries, other APIs and origins", async () => {
  const { listeners } = await loadWorker();
  for (const request of [
    new Request(CATALOG_URL, { headers: { Authorization: "Bearer private" } }),
    new Request(CATALOG_URL, { headers: { Cookie: "session=private" } }),
    new Request(`${CATALOG_URL}?account=private`),
    new Request(`${CATALOG_URL}/extra`),
    new Request("https://other.test/api/offline/catalog"),
    new Request("https://festivals.test/api/auth/me"),
    new Request(CATALOG_URL, { method: "POST" }),
  ]) assert.equal(dispatch(listeners, request), undefined);
});

test("first network response survives Cache Storage open and write failures", async () => {
  for (const failure of ["open", "put"]) {
    const { cache, caches } = memoryCache();
    if (failure === "open") caches.open = async () => { throw new Error("storage unavailable"); };
    else cache.put = async () => { throw new Error("quota"); };
    const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async () => catalogReply() });
    assert.deepEqual(await (await dispatch(listeners)).json(), payload());
  }
});

test("install warms DB catalogue anonymously but DB failure preserves legacy precache", async () => {
  for (const available of [true, false]) {
    const { cache, caches } = memoryCache();
    const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
      if (request instanceof Request) {
        assert.equal(request.credentials, "omit");
        if (!available) throw new TypeError("DB unavailable");
        return catalogReply();
      }
      return new Response(String(request).endsWith(".json") ? JSON.stringify({ festivals: [] }) : "asset");
    } });
    let installed;
    listeners.install({ waitUntil: (promise) => { installed = promise; } });
    await installed;
    assert.ok(await cache.match("/offline/festivals-2027-v1.json"));
    assert.ok(await cache.match("/offline.html"));
    assert.equal(Boolean(await cache.match(CATALOG_URL)), available);
  }
});

test("navigation fallback cannot read another cache's private response", async () => {
  const { cache, caches } = memoryCache();
  caches.match = async () => new Response("private account");
  await cache.put("/offline.html", new Response("public shell"));
  const { listeners } = await loadWorker({ cachesImpl: caches });
  const result = dispatch(listeners, { method: "GET", url: "https://festivals.test/festivals/a", mode: "navigate" });
  assert.equal(await (await result).text(), "public shell");
});

test("unsafe 304 metadata cannot renew a public cache entry", async () => {
  const { cache, caches } = memoryCache();
  const stamp = Date.now() - 60000;
  await seed(cache, catalogReply(), stamp);
  const requests = [];
  const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async (request) => {
    requests.push(request);
    return requests.length === 1
      ? catalogReply(revisionA, { status: 304, headers: { "Cache-Control": "private" } })
      : new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  } });
  assert.equal((await dispatch(listeners)).status, 503);
  assert.equal(requests[1].headers.get("if-none-match"), null);
  assert.equal(Number((await cache.match(CATALOG_URL)).headers.get("x-festival-radar-cached-at")), stamp);
});

test("canonical trailing-slash consumer shares the saved body with the bare endpoint", async () => {
  const { cache, caches } = memoryCache();
  await seed(cache);
  const { listeners } = await loadWorker({ cachesImpl: caches });
  assert.deepEqual(await (await dispatch(listeners, new Request(`${CATALOG_URL}/`))).json(), payload());
});

test("redirected catalogue responses cannot be cached even with public headers", async () => {
  const { cache, caches } = memoryCache();
  const response = catalogReply();
  Object.defineProperty(response, "redirected", { value: true });
  const { listeners } = await loadWorker({ cachesImpl: caches, fetchImpl: async () => response });
  assert.equal((await dispatch(listeners)).status, 200);
  assert.equal(await cache.match(CATALOG_URL), undefined);
});
