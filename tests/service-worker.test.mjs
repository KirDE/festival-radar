import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWorker({ fetchImpl, cachesImpl } = {}) {
  const listeners = {};
  const context = {
    module: { exports: {} }, URL, Headers, Response, Blob,
    fetch: fetchImpl || (() => Promise.reject(new TypeError("offline"))),
    caches: cachesImpl || { match: async () => new Response("offline") },
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
