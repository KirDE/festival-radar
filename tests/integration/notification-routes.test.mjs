import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!/(?:test|integration)/i.test(databaseName)) throw new Error(`Refusing non-test database: ${databaseName}`);

const appPort = 3231;
const providerPort = 3232;
const appUrl = `http://127.0.0.1:${appPort}`;
const providerUrl = `http://127.0.0.1:${providerPort}`;
const internalSecret = "notification-integration-secret";
const db = new PrismaClient();
let app;
let provider;
let providerStatus = 200;
let providerDelay = 0;
let providerCalls = [];

class Client {
  cookies = new Map();
  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    const method = options.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) headers.set("origin", appUrl);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(`${appUrl}${path}`, { ...options, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    if (response.status === 308) {
      const location = new URL(response.headers.get("location"), appUrl);
      return this.request(`${location.pathname}${location.search}`, options);
    }
    return response;
  }
  json(path, method = "GET", body, headers) {
    return this.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
}

const internal = (path, body) => new Client().json(path, "POST", body, { authorization: `Bearer ${internalSecret}` });

async function waitForApp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(appUrl)).status < 500) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js integration server did not start");
}

test.before(async () => {
  await db.notificationDelivery.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationSubscription.deleteMany();
  await db.notificationPreference.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany({ where: { adminAuditEntries: { none: {} } } });
  provider = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    providerCalls.push({ key: request.headers["idempotency-key"], body: JSON.parse(body) });
    if (providerDelay) await new Promise((resolve) => setTimeout(resolve, providerDelay));
    response.statusCode = providerStatus;
    response.end(providerStatus < 400 ? "ok" : "failed");
  }).listen(providerPort, "127.0.0.1");
  await once(provider, "listening");
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: "notification-auth-secret-at-least-32-characters", APP_URL: appUrl, INTERNAL_API_SECRET: internalSecret, EMAIL_WEBHOOK_URL: providerUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  app.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  app.on("exit", (code) => { if (code && code !== 143) process.stderr.write(`Next exited ${code}:\n${output}\n`); });
  await waitForApp();
});

test.after(async () => {
  if (app?.exitCode === null) { app.kill("SIGTERM"); await once(app, "exit"); }
  await new Promise((resolve) => provider.close(resolve));
  await db.$disconnect();
});

test("notification routes and PostgreSQL delivery invariants", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.json("/api/notifications/preferences")).status, 401);
  assert.equal((await anonymous.json("/api/notifications/subscriptions")).status, 401);
  assert.equal((await anonymous.json("/api/notifications/events", "POST", {})).status, 401);
  assert.equal((await anonymous.json("/api/notifications/dispatch", "POST", {})).status, 401);

  const client = new Client();
  assert.equal((await client.json("/api/auth/register", "POST", { email: "notify@example.com", password: "correct horse battery staple" })).status, 201);
  const user = await db.user.findUniqueOrThrow({ where: { email: "notify@example.com" } });
  const unverifiedPreference = { festivalId: null, eventType: "ARTIST_ADDED", channel: "EMAIL", frequency: "IMMEDIATE", enabled: true };
  assert.equal((await client.json("/api/notifications/preferences", "PUT", unverifiedPreference)).status, 409);
  assert.equal((await client.json("/api/notifications/status", "POST", { channel: "EMAIL" })).status, 409);

  const unverifiedEvent = await db.notificationEvent.create({ data: { dedupeKey: "unverified-email", festivalId: "notification-test", type: "TIMETABLE_PUBLISHED", title: "Should not send", message: "Unverified", occurredAt: new Date() } });
  const unverifiedDelivery = await db.notificationDelivery.create({ data: { eventId: unverifiedEvent.id, userId: user.id, channel: "EMAIL", frequency: "IMMEDIATE", nextAttemptAt: new Date() } });
  await internal("/api/notifications/dispatch", {});
  assert.equal((await db.notificationDelivery.findUniqueOrThrow({ where: { id: unverifiedDelivery.id } })).status, "SKIPPED");
  assert.equal(providerCalls.length, 0);

  const verification = await client.json("/api/auth/email-verification/request", "POST", {});
  assert.equal(verification.status, 202);
  assert.equal((await client.json("/api/auth/email-verification/request", "POST", {})).status, 429);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].body.kind, "email-verification");
  assert.equal(providerCalls[0].body.to, "notify@example.com");
  const confirmationUrl = new URL(providerCalls[0].body.text.match(/https?:\/\/\S+/)[0]);
  const rawToken = confirmationUrl.searchParams.get("token");
  assert.ok(rawToken);
  const storedToken = await db.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.notEqual(storedToken.tokenHash, rawToken);
  assert.equal((await client.request(`${confirmationUrl.pathname}${confirmationUrl.search}`)).status, 303);
  assert.equal((await client.request(`${confirmationUrl.pathname}${confirmationUrl.search}`)).status, 410);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt instanceof Date, true);
  assert.equal((await (await client.json("/api/auth/me")).json()).user.emailVerified, true);
  providerCalls = [];

  const subscription = { channel: "EMAIL", endpoint: "notify@example.com", enabled: true };
  assert.equal((await client.json("/api/notifications/subscriptions", "PUT", subscription, { origin: "https://foreign.example" })).status, 403);
  assert.equal(await db.notificationSubscription.count({ where: { userId: user.id } }), 0);
  assert.equal((await client.json("/api/notifications/subscriptions", "PUT", subscription)).status, 200);
  assert.equal((await client.json("/api/notifications/subscriptions", "PUT", subscription)).status, 200);
  assert.equal((await client.json("/api/notifications/subscriptions")).status, 200);
  assert.equal(await db.notificationSubscription.count({ where: { userId: user.id } }), 1);

  const global = { festivalId: null, eventType: "ARTIST_ADDED", channel: "EMAIL", frequency: "IMMEDIATE", enabled: true };
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => client.json("/api/notifications/preferences", "PUT", { ...global, frequency: index % 2 ? "DAILY" : "IMMEDIATE" })));
  assert.ok(concurrent.every((response) => response.status === 200));
  assert.equal(await db.notificationPreference.count({ where: { userId: user.id, festivalId: null, eventType: "ARTIST_ADDED", channel: "EMAIL" } }), 1);
  assert.equal((await client.json("/api/notifications/preferences", "PUT", { ...global, frequency: "IMMEDIATE" })).status, 200);
  assert.equal((await client.json("/api/notifications/preferences", "PUT", { ...global, festivalId: "festival-a" })).status, 200);
  assert.equal(await db.notificationPreference.count({ where: { userId: user.id } }), 2);
  assert.equal((await client.json("/api/notifications/preferences")).status, 200);

  const event = { dedupeKey: "lineup:festival-a:artist-1", festivalId: "festival-a", type: "ARTIST_ADDED", title: "Artist added", message: "Artist One", occurredAt: new Date().toISOString() };
  assert.equal((await internal("/api/notifications/events", event)).status, 202);
  assert.equal((await internal("/api/notifications/events", event)).status, 202);
  assert.equal(await db.notificationEvent.count({ where: { dedupeKey: event.dedupeKey } }), 1);
  assert.equal(await db.notificationDelivery.count({ where: { event: { dedupeKey: event.dedupeKey } } }), 1);

  await client.json("/api/notifications/preferences", "PUT", { festivalId: "festival-b", eventType: "ARTIST_ADDED", channel: "EMAIL", frequency: "DAILY", enabled: true });
  await client.json("/api/notifications/preferences", "PUT", { festivalId: "festival-c", eventType: "ARTIST_ADDED", channel: "EMAIL", frequency: "WEEKLY", enabled: true });
  const before = Date.now();
  await internal("/api/notifications/events", { ...event, dedupeKey: "daily", festivalId: "festival-b" });
  await internal("/api/notifications/events", { ...event, dedupeKey: "weekly", festivalId: "festival-c" });
  const daily = await db.notificationDelivery.findFirstOrThrow({ where: { event: { dedupeKey: "daily" }, frequency: "DAILY" } });
  const weekly = await db.notificationDelivery.findFirstOrThrow({ where: { event: { dedupeKey: "weekly" }, frequency: "WEEKLY" } });
  assert.ok(daily.nextAttemptAt.getTime() > before && daily.nextAttemptAt.getTime() - before < 2 * 86_400_000);
  assert.equal(daily.nextAttemptAt.getUTCHours(), 8);
  assert.ok(weekly.nextAttemptAt.getTime() > before);
  assert.ok(weekly.nextAttemptAt.getTime() - before <= 7 * 86_400_000);
  assert.equal(weekly.nextAttemptAt.getUTCDay(), 1);
  assert.equal(weekly.nextAttemptAt.getUTCHours(), 8);

  providerCalls = [];
  providerDelay = 250;
  const dispatches = await Promise.all([internal("/api/notifications/dispatch", {}), internal("/api/notifications/dispatch", {})]);
  assert.ok(dispatches.every((response) => response.status === 200));
  assert.equal(providerCalls.length, 1);
  const sent = await db.notificationDelivery.findFirstOrThrow({ where: { event: { dedupeKey: event.dedupeKey } } });
  assert.equal(sent.status, "SENT");
  assert.equal(sent.attempts, 1);
  assert.equal(providerCalls[0].key, sent.id);
  providerDelay = 0;

  await db.notificationDelivery.updateMany({ where: { frequency: "DAILY" }, data: { nextAttemptAt: new Date(0) } });
  providerStatus = 503;
  const retryResponse = await internal("/api/notifications/dispatch", { frequency: "DAILY" });
  assert.equal(retryResponse.status, 200);
  let retry = await db.notificationDelivery.findFirstOrThrow({ where: { event: { dedupeKey: "daily" }, frequency: "DAILY" } });
  assert.equal(retry.status, "PENDING");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.nextAttemptAt.getTime() >= Date.now() + 100_000);
  await db.notificationDelivery.update({ where: { id: retry.id }, data: { attempts: 4, nextAttemptAt: new Date(0) } });
  await internal("/api/notifications/dispatch", { frequency: "DAILY" });
  retry = await db.notificationDelivery.findUniqueOrThrow({ where: { id: retry.id } });
  assert.equal(retry.status, "FAILED");
  assert.equal(retry.attempts, 5);

  await client.json("/api/notifications/preferences", "PUT", { festivalId: "festival-d", eventType: "ARTIST_ADDED", channel: "WEB_PUSH", frequency: "IMMEDIATE", enabled: true });
  await internal("/api/notifications/events", { ...event, dedupeKey: "skip", festivalId: "festival-d" });
  const callsBeforeSkip = providerCalls.length;
  await internal("/api/notifications/dispatch", { frequency: "IMMEDIATE" });
  const skipped = await db.notificationDelivery.findFirstOrThrow({ where: { event: { dedupeKey: "skip" }, channel: "WEB_PUSH" } });
  assert.equal(skipped.status, "SKIPPED");
  assert.equal(providerCalls.slice(callsBeforeSkip).some((call) => call.key === skipped.id), false);
});
