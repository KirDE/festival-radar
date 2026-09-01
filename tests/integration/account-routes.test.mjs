import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!/(?:test|integration)/i.test(databaseName)) {
  throw new Error(`Refusing to reset non-test database: ${databaseName}`);
}

const appPort = 3219;
const mockPort = 3220;
const appUrl = `http://127.0.0.1:${appPort}`;
const mockUrl = `http://127.0.0.1:${mockPort}`;
const authSecret = "integration-auth-secret-with-at-least-32-characters";
const db = new PrismaClient();
let app;
let mock;
let failPlaylists = false;

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

  json(path, method = "GET", body) {
    return this.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  }
}

async function waitForApp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(appUrl);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js integration server did not start");
}

async function startApp(configured) {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: authSecret,
      APP_URL: appUrl,
      ...(configured ? {
        SPOTIFY_CLIENT_ID: "integration-client",
        SPOTIFY_CLIENT_SECRET: "integration-secret",
        SPOTIFY_ACCOUNTS_URL: mockUrl,
        SPOTIFY_API_URL: mockUrl,
      } : {
        SPOTIFY_CLIENT_ID: "",
        SPOTIFY_CLIENT_SECRET: "",
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  app.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  app.on("exit", (code) => {
    if (code && code !== 143) process.stderr.write(`Next.js exited ${code}:\n${output}\n`);
  });
  await waitForApp();
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  app.kill("SIGTERM");
  await once(app, "exit");
}

function decrypt(ciphertext) {
  const [iv, tag, body] = ciphertext.split(".").map((part) => Buffer.from(part, "base64url"));
  const key = createHash("sha256").update(authSecret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

test.before(async () => {
  await db.notificationDelivery.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationSubscription.deleteMany();
  await db.notificationPreference.deleteMany();
  await db.spotifyConnection.deleteMany();
  await db.shareLink.deleteMany();
  await db.syncDocument.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();

  mock = http.createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/token") {
      response.end(JSON.stringify({ access_token: "mock-access-token", refresh_token: "mock-refresh-token" }));
      return;
    }
    if (request.url === "/v1/me") {
      response.end(JSON.stringify({ id: "spotify-user-1" }));
      return;
    }
    if (request.url?.startsWith("/v1/me/playlists")) {
      if (failPlaylists) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "upstream unavailable" }));
        return;
      }
      const page2 = request.url.includes("offset=1");
      const item = (id) => ({ id, name: `Playlist ${id}`, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` }, images: [], owner: { id: "owner", display_name: null }, tracks: { total: 3 } });
      response.end(JSON.stringify({ items: [item(page2 ? "two" : "one")], next: page2 ? null : `${mockUrl}/v1/me/playlists?limit=50&offset=1` }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  }).listen(mockPort, "127.0.0.1");
  await once(mock, "listening");
  await startApp(false);
});

test.after(async () => {
  await stopApp();
  await new Promise((resolve) => mock.close(resolve));
  await db.$disconnect();
});

test("auth, sync, sharing, and Spotify OAuth work against PostgreSQL", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.json("/api/auth/me")).status, 401);
  assert.equal((await anonymous.json("/api/sync/favorites")).status, 401);
  assert.equal((await anonymous.json("/api/share", "POST", { documentId: "x" })).status, 401);
  assert.equal((await anonymous.json("/api/spotify/sync", "POST")).status, 401);

  assert.equal((await anonymous.json("/api/auth/register", "POST", { email: "bad", password: "short" })).status, 400);
  const registration = await anonymous.json("/api/auth/register", "POST", { email: "First@Example.com", password: "correct horse battery staple" });
  assert.equal(registration.status, 201);
  const sessionCookie = registration.headers.getSetCookie().find((value) => value.startsWith("festival_radar_session="));
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Lax/i);
  assert.match(sessionCookie, /Path=\//i);
  assert.match(sessionCookie, /Expires=/i);
  assert.equal((await new Client().json("/api/auth/register", "POST", { email: "first@example.com", password: "correct horse battery staple" })).status, 409);
  assert.equal((await anonymous.request("/api/auth/logout", { method: "POST", headers: { origin: "https://foreign.example" } })).status, 403);
  assert.equal((await anonymous.json("/api/auth/me")).status, 200);
  assert.equal((await anonymous.json("/api/auth/logout", "POST")).status, 204);
  assert.equal((await anonymous.json("/api/auth/me")).status, 401);
  assert.equal((await anonymous.json("/api/auth/login", "POST", { email: "first@example.com", password: "wrong" })).status, 401);
  assert.equal((await anonymous.json("/api/auth/login", "POST", { email: "first@example.com", password: "correct horse battery staple" })).status, 200);

  const firstUser = await db.user.findUniqueOrThrow({ where: { email: "first@example.com" } });
  await db.session.updateMany({ where: { userId: firstUser.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await anonymous.json("/api/auth/me")).status, 401);
  assert.equal((await anonymous.json("/api/auth/login", "POST", { email: "first@example.com", password: "correct horse battery staple" })).status, 200);

  assert.equal((await anonymous.json("/api/sync/nope")).status, 404);
  assert.equal((await anonymous.json("/api/sync/favorites", "PUT", { payload: null, revision: 0 })).status, 400);
  const created = await anonymous.json("/api/sync/favorites", "PUT", { payload: { festivals: ["wacken"] }, revision: 0 });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.document.revision, 1);
  assert.equal((await anonymous.request("/api/sync/favorites", { method: "PUT", headers: { origin: "https://foreign.example", "content-type": "application/json" }, body: JSON.stringify({ payload: { festivals: ["forged"] }, revision: 1 }) })).status, 403);
  assert.equal((await db.syncDocument.findUniqueOrThrow({ where: { id: createdBody.document.id } })).revision, 1);
  const updated = await anonymous.json("/api/sync/favorites", "PUT", { payload: { festivals: ["wacken", "graspop"] }, revision: 1 });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).document.revision, 2);
  assert.equal((await anonymous.json("/api/sync/favorites", "PUT", { payload: { festivals: [] }, revision: 1 })).status, 409);

  const second = new Client();
  assert.equal((await second.json("/api/auth/register", "POST", { email: "second@example.com", password: "another secure password" })).status, 201);
  assert.equal((await (await second.json("/api/sync/favorites")).json()).document, null);
  assert.equal((await second.json("/api/share", "POST", { documentId: createdBody.document.id })).status, 404);

  const share = await anonymous.json("/api/share", "POST", { documentId: createdBody.document.id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(share.status, 201);
  const shareBody = await share.json();
  const publicShare = await new Client().json(`/api/share/${shareBody.share.slug}`);
  assert.equal(publicShare.status, 200);
  const publicBody = await publicShare.json();
  assert.deepEqual(Object.keys(publicBody).sort(), ["kind", "payload", "updatedAt"]);
  assert.equal(publicBody.userId, undefined);
  assert.equal((await new Client().json("/api/share/unknown-slug")).status, 404);
  await db.shareLink.update({ where: { slug: shareBody.share.slug }, data: { expiresAt: new Date(0) } });
  assert.equal((await new Client().json(`/api/share/${shareBody.share.slug}`)).status, 404);

  assert.equal((await anonymous.json("/api/spotify/connect")).status, 503);
  await stopApp();
  await startApp(true);

  const connect = await anonymous.json("/api/spotify/connect");
  assert.equal(connect.status, 302);
  const authorization = new URL(connect.headers.get("location"));
  const validState = authorization.searchParams.get("state");
  assert.ok(validState);
  assert.equal((await anonymous.json(`/api/spotify/callback?code=code&state=wrong`)).status, 400);

  const reconnect = await anonymous.json("/api/spotify/connect");
  const reconnectUrl = new URL(reconnect.headers.get("location"));
  const callback = await anonymous.json(`/api/spotify/callback?code=code&state=${encodeURIComponent(reconnectUrl.searchParams.get("state"))}`);
  assert.equal(callback.status, 302);
  const connection = await db.spotifyConnection.findUniqueOrThrow({ where: { userId: firstUser.id } });
  assert.notEqual(connection.encryptedRefreshToken, "mock-refresh-token");
  assert.equal(decrypt(connection.encryptedRefreshToken), "mock-refresh-token");

  const sync = await anonymous.json("/api/spotify/sync", "POST");
  assert.equal(sync.status, 200);
  const syncBody = await sync.json();
  assert.deepEqual(syncBody.document.payload.playlists.map((playlist) => playlist.id), ["one", "two"]);
  failPlaylists = true;
  assert.equal((await anonymous.json("/api/spotify/sync", "POST")).status, 502);
});
