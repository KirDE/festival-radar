import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/NotificationSettings.tsx", import.meta.url), "utf8");
const preferences = readFileSync(new URL("../app/api/notifications/preferences/route.ts", import.meta.url), "utf8");
const subscriptions = readFileSync(new URL("../app/api/notifications/subscriptions/route.ts", import.meta.url), "utf8");
const status = readFileSync(new URL("../app/api/notifications/status/route.ts", import.meta.url), "utf8");
const providerState = readFileSync(new URL("../lib/notification-providers.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("settings cover every supported event, channel and frequency", () => {
  for (const value of ["ARTIST_ADDED", "ARTIST_CANCELLED", "FESTIVAL_DATE_MOVED", "TICKETS_ON_SALE", "TICKETS_LOW", "TICKETS_SOLD_OUT", "TIMETABLE_PUBLISHED", "EMAIL", "TELEGRAM", "WEB_PUSH", "IMMEDIATE", "DAILY", "WEEKLY"]) assert.match(component, new RegExp(value));
});

test("select options preserve canonical values while labels are localized", () => {
  assert.match(component, /<option key=\{v\} value=\{v\}>\{t\.eventNames\[v\]\}<\/option>/);
  for (const value of ["ARTIST_CANCELLED", "FESTIVAL_DATE_MOVED", "TICKETS_ON_SALE", "TICKETS_LOW", "TICKETS_SOLD_OUT", "TIMETABLE_PUBLISHED"]) {
    assert.match(component, new RegExp(`${value}:`));
  }
  for (const localized of ["Gespeichert.", "Сохранено.", "Anfrage fehlgeschlagen.", "Не удалось выполнить запрос."]) assert.match(component, new RegExp(localized.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(component, /setMessage\("Saved\."\)/);
});

test("authenticated mobile header constrains long account identities", () => {
  assert.match(css, /\.siteHeader \.accountMenu \{ max-width: min\(48%, 190px\); min-width: 0; \}/);
  assert.match(css, /\.siteHeader \.accountButton \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(css, /\.siteHeader nav \{ order: 3; width: 100%;[^}]*flex-wrap: wrap;/);
});

test("channel onboarding is permission-aware and endpoints stay redacted", () => {
  assert.match(component, /Notification\.requestPermission/);
  assert.match(component, /pushManager\.subscribe/);
  assert.match(component, /pattern="-\?\[0-9\]\+"/);
  assert.match(status, /browser subscription/);
  assert.match(status, /notificationProviderState\(\)/);
  assert.match(providerState, /TELEGRAM: Boolean\(process\.env\.TELEGRAM_BOT_TOKEN\)/);
  assert.match(providerState, /WEB_PUSH: Boolean\(process\.env\.WEB_PUSH_WEBHOOK_URL && process\.env\.NEXT_PUBLIC_WEB_PUSH_VAPID_KEY\)/);
  assert.doesNotMatch(status, /TELEGRAM_BOT_TOKEN/);
  assert.match(component, /disabled=\{busy \|\| !providers\[channel\] \|\| \(channel === "EMAIL" && !emailVerified\)\}/);
  assert.match(component, /disabled=\{busy \|\| !providers\.TELEGRAM/);
  assert.match(component, /disabled=\{busy \|\| !providers\.WEB_PUSH \|\| !vapid\}/);
});

test("user-owned preferences and subscriptions can be disabled and deleted", () => {
  assert.match(component, /enabled: !p\.enabled/);
  assert.match(preferences, /deleteMany\(\{ where: \{ id: parsed\.data\.id, userId: user\.id/);
  assert.match(subscriptions, /deleteMany\(\{ where: \{ id: parsed\.data\.id, userId: user\.id/);
});
