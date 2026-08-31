import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadWorker() {
  const listeners = {};
  const context = {
    module: { exports: {} }, URL, Headers, Response, Blob,
    fetch: () => Promise.reject(new TypeError("offline")),
    caches: { match: async () => new Response("offline") },
    self: { location: { origin: "https://festivals.test" }, addEventListener: (name, fn) => { listeners[name] = fn; } },
  };
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  return { helpers: context.module.exports, listeners };
}

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
