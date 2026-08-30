import assert from "node:assert/strict";
import test from "node:test";
import { pageViewPayload, privacySignalEnabled, sendPrivacyPageView } from "../lib/privacy-analytics.mjs";
const documentLike = (lang = "en") => ({ documentElement: { lang } });

test("analytics is disabled without an endpoint", () => {
  let sent = 0;
  assert.equal(sendPrivacyPageView({ endpoint: "", pathname: "/", document: documentLike(), navigator: { sendBeacon: () => { sent += 1; } } }), false);
  assert.equal(sent, 0);
});
test("DNT and Global Privacy Control suppress analytics", () => {
  assert.equal(privacySignalEnabled({ doNotTrack: "1" }), true);
  assert.equal(privacySignalEnabled({ doNotTrack: "0", globalPrivacyControl: true }), true);
});
test("payload contains only a normalized path and supported locale", () => {
  assert.deepEqual(pageViewPayload("/de/festivals/wacken?secret=yes#day", documentLike("ru")), { path: "/de/festivals/wacken", locale: "de" });
  assert.deepEqual(pageViewPayload("https://other.test/private", documentLike("ru-RU")), { path: "/", locale: "ru" });
});
test("initial load and distinct SPA paths each send one minimized beacon", async () => {
  const payloads = [];
  const navigator = { doNotTrack: "0", sendBeacon: (_endpoint, blob) => { payloads.push(blob); return true; } };
  let previous = null;
  for (const pathname of ["/", "/festivals", "/festivals"]) {
    if (pathname === previous) continue;
    previous = pathname;
    sendPrivacyPageView({ endpoint: "/api/analytics/page-view", pathname, navigator, document: documentLike() });
  }
  assert.equal(payloads.length, 2);
  const bodies = await Promise.all(payloads.map((blob) => blob.text()));
  assert.deepEqual(bodies.map(JSON.parse), [{ path: "/", locale: "en" }, { path: "/festivals", locale: "en" }]);
  assert.equal(bodies.some((body) => /cookie|referrer|query|id/i.test(body)), false);
});
