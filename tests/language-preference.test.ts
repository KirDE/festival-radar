import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { preferredLanguage, isLanguage, LANGUAGE_PREFERENCE_KEY } from "../lib/language-preference.ts";
import { proxy, config } from "../proxy.ts";

test("fresh direct links use the route language; stored choices survive a different route", () => {
  for (const locale of ["en", "de", "ru"] as const) {
    assert.equal(preferredLanguage(null, undefined, locale, "en"), locale);
    assert.equal(preferredLanguage(locale, "en", "en", "en"), locale);
    assert.equal(preferredLanguage(null, locale, "en", "en"), locale);
  }
  assert.equal(preferredLanguage("invalid", "invalid", undefined, "ru"), "ru");
  assert.equal(preferredLanguage("invalid", undefined, "de", "ru"), "de");
  for (const value of [null, "DE", "fr", "en; session=bad"]) assert.equal(isLanguage(value), false);
});

test("bare-route SSR uses only a supported preference and isolates cookie-dependent documents", () => {
  for (const path of ["/", "/admin/", "/planner/", "/notifications/", "/artists/example/"]) {
    for (const [value,expected] of [["de","de"],["ru","ru"],["invalid","en"]]) {
      const request = new NextRequest(`https://example.test${path}?filter=keep`, {headers:{cookie:`session=auth; ${LANGUAGE_PREFERENCE_KEY}=${value}`,"x-festival-locale":"untrusted"}});
      const response = proxy(request);
      assert.equal(response.headers.get("x-middleware-request-x-festival-locale"), expected);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("vary"), "Cookie");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("location"), null);
      assert.equal(request.headers.get("cookie"), `session=auth; ${LANGUAGE_PREFERENCE_KEY}=${value}`);
    }
  }
});

test("prefixed route SSR retains URL locale and static asset caching is unchanged", () => {
  for (const path of ["/en/planner/", "/de/artists/example/", "/ru/"]) {
    const response = proxy(new NextRequest(`https://example.test${path}`,{headers:{cookie:`${LANGUAGE_PREFERENCE_KEY}=ru`}}));
    assert.equal(response.headers.get("x-middleware-request-x-festival-locale"), path.split("/")[1]);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const path of ["/sw.js", "/manifest.webmanifest", "/offline.html"]) {
    assert.equal(proxy(new NextRequest(`https://example.test${path}`)).headers.get("cache-control"), null);
  }
});

test("locale proxy remains excluded from API requests", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for (const path of ["/api/auth/me/", "/api/admin/", "/api/offline/catalog/", "/_next/static/chunk.js", "/_next/image", "/favicon.ico"]) {
    assert.equal(matcher.test(path), false);
  }
  assert.equal(matcher.test("/planner/"), true);
});
