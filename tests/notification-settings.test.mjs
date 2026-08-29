import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/NotificationSettings.tsx", import.meta.url), "utf8");
const preferences = readFileSync(new URL("../app/api/notifications/preferences/route.ts", import.meta.url), "utf8");
const subscriptions = readFileSync(new URL("../app/api/notifications/subscriptions/route.ts", import.meta.url), "utf8");
const status = readFileSync(new URL("../app/api/notifications/status/route.ts", import.meta.url), "utf8");

test("settings cover every supported event, channel and frequency", () => {
  for (const value of ["ARTIST_ADDED", "ARTIST_CANCELLED", "FESTIVAL_DATE_MOVED", "TICKETS_ON_SALE", "TICKETS_LOW", "TICKETS_SOLD_OUT", "TIMETABLE_PUBLISHED", "EMAIL", "TELEGRAM", "WEB_PUSH", "IMMEDIATE", "DAILY", "WEEKLY"]) assert.match(component, new RegExp(value));
});

test("channel onboarding is permission-aware and endpoints stay redacted", () => {
  assert.match(component, /Notification\.requestPermission/);
  assert.match(component, /pushManager\.subscribe/);
  assert.match(component, /pattern="-\?\[0-9\]\+"/);
  assert.match(status, /browser subscription/);
  assert.match(status, /TELEGRAM: Boolean\(process\.env\.TELEGRAM_BOT_TOKEN\)/);
  assert.doesNotMatch(status, /TELEGRAM_BOT_TOKEN\s*[,}]/);
});

test("user-owned preferences and subscriptions can be disabled and deleted", () => {
  assert.match(component, /enabled: !p\.enabled/);
  assert.match(preferences, /deleteMany\(\{ where: \{ id: parsed\.data\.id, userId: user\.id/);
  assert.match(subscriptions, /deleteMany\(\{ where: \{ id: parsed\.data\.id, userId: user\.id/);
});
