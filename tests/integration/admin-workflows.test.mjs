import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) throw new Error("A test DATABASE_URL is required");
const db = new PrismaClient();
const port = 3244;
const origin = `http://127.0.0.1:${port}`;
let app;
let sourceMode = "success";
const sourceServer = createServer((_, response) => {
  if (sourceMode === "failure") { response.writeHead(503); response.end("unavailable"); return; }
  response.setHeader("content-type", "text/html");
  response.end(`<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","name":"Wacken Open Air","startDate":"2027-07-29","endDate":"2027-08-01","location":{"@type":"Place","address":{"addressLocality":"Wacken Integration"}},"performer":[{"@type":"MusicGroup","name":"Integration Band"}],"offers":{"@type":"Offer","url":"https://tickets.example.test/integration"}}</script>`);
});

class Client {
  cookies = new Map();
  async json(path, method = "GET", body) {
    const headers = new Headers();
    if (body !== undefined) headers.set("content-type", "application/json");
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";"); const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    if (response.status === 308) return this.json(new URL(response.headers.get("location"), origin).pathname, method, body);
    return response;
  }
}

test.before(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "AdminChange", "AdminDraft", "AdminParserRun", "AdminResourceState", "AdminAuditEntry", "Session", "User" CASCADE');
  sourceServer.listen(3250, "127.0.0.1"); await once(sourceServer, "listening");
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], { env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: "admin-integration-secret-at-least-32", ADMIN_TEST_SOURCE_URL: "http://127.0.0.1:3250/source" }, stdio: "ignore" });
  for (let attempt = 0; attempt < 120; attempt += 1) { try { if ((await fetch(origin)).status < 500) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); }
  throw new Error("Integration server did not start");
});
test.after(async () => { if (app?.exitCode === null) { app.kill("SIGTERM"); await once(app, "exit"); } sourceServer.close(); await once(sourceServer, "close"); await db.$disconnect(); });

test("persisted admin drafts, decisions, conflicts, authorization and audit invariants", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.json("/api/admin")).status, 403);
  assert.equal((await anonymous.json("/api/admin", "POST", {})).status, 403);
  assert.equal((await anonymous.json("/api/admin/changes/missing", "POST", { decision: "approve" })).status, 403);
  assert.equal((await anonymous.json("/api/admin/drafts/missing", "PATCH", { values: { city: "x" } })).status, 403);
  assert.equal((await anonymous.json("/api/admin/drafts/missing", "DELETE")).status, 403);
  assert.equal((await anonymous.json("/api/admin/refresh/wacken-open-air", "POST")).status, 403);
  const nonAdmin = new Client();
  assert.equal((await nonAdmin.json("/api/auth/register", "POST", { email: "viewer@example.test", password: "correct horse battery staple" })).status, 201);
  assert.equal((await nonAdmin.json("/api/admin")).status, 403);
  const admin = new Client();
  assert.equal((await admin.json("/api/auth/register", "POST", { email: "admin@example.test", password: "correct horse battery staple" })).status, 201);
  await db.user.update({ where: { email: "admin@example.test" }, data: { role: "ADMIN" } });
  const draftResponse = await admin.json("/api/admin", "POST", { resourceKind: "festival", resourceKey: "wacken-open-air", baseRevision: 0, values: { city: "Wacken Preview", status: "confirmed" } });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal((await admin.json(`/api/admin/drafts/${draft.id}`, "PATCH", { values: { city: "Wacken Preview", status: "confirmed", country: "Germany" } })).status, 200);
  assert.equal(await db.adminChange.count({ where: { draftId: draft.id } }), 3);
  const city = await db.adminChange.findFirstOrThrow({ where: { draftId: draft.id, field: "city" } });
  assert.equal((await admin.json(`/api/admin/changes/${city.id}`, "POST", { decision: "approve" })).status, 200);
  assert.deepEqual((await db.adminResourceState.findUniqueOrThrow({ where: { resourceKind_resourceKey: { resourceKind: "FESTIVAL", resourceKey: "wacken-open-air" } } })).values, { city: "Wacken Preview" });
  assert.equal((await admin.json("/api/admin", "POST", { resourceKind: "festival", resourceKey: "wacken-open-air", baseRevision: 0, values: { city: "stale" } })).status, 409);
  const status = await db.adminChange.findFirstOrThrow({ where: { draftId: draft.id, field: "status" } });
  assert.equal((await admin.json(`/api/admin/changes/${status.id}`, "POST", { decision: "reject" })).status, 200);
  assert.equal((await db.adminResourceState.findUniqueOrThrow({ where: { resourceKind_resourceKey: { resourceKind: "FESTIVAL", resourceKey: "wacken-open-air" } } })).values.city, "Wacken Preview");
  const disposableResponse = await admin.json("/api/admin", "POST", { resourceKind: "asset", resourceKey: "delete-me", baseRevision: 0, values: { logoUrl: "https://example.test/logo.svg" } });
  const disposable = await disposableResponse.json();
  assert.equal((await admin.json(`/api/admin/drafts/${disposable.id}`, "DELETE")).status, 200);
  assert.equal(await db.adminDraft.count({ where: { id: disposable.id } }), 0);

  const refresh = await admin.json("/api/admin/refresh/wacken-open-air", "POST");
  assert.equal(refresh.status, 201);
  const successfulRun = await refresh.json();
  assert.match(successfulRun.message, /change\(s\) queued/);
  assert.ok(await db.adminChange.count({ where: { parserRunId: successfulRun.id } }));
  sourceMode = "failure";
  assert.equal((await admin.json("/api/admin/refresh/wacken-open-air", "POST")).status, 502);
  assert.equal((await db.adminParserRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } })).status, "FAILED");

  const conflictA = await db.adminChange.create({ data: { resourceKind: "LINK", resourceKey: "concurrent", field: "url", baseRevision: 0, beforeValue: null, afterValue: "https://a.example", sourceEvidence: { test: true } } });
  const conflictB = await db.adminChange.create({ data: { resourceKind: "LINK", resourceKey: "concurrent", field: "url", baseRevision: 0, beforeValue: null, afterValue: "https://b.example", sourceEvidence: { test: true } } });
  const results = await Promise.all([conflictA, conflictB].map((change) => admin.json(`/api/admin/changes/${change.id}`, "POST", { decision: "approve" })));
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const published = await db.adminResourceState.findUniqueOrThrow({ where: { resourceKind_resourceKey: { resourceKind: "LINK", resourceKey: "concurrent" } } });
  assert.ok(["https://a.example", "https://b.example"].includes(published.values.url));
  assert.equal(published.revision, 1);

  const audit = await db.adminAuditEntry.findMany({ orderBy: { createdAt: "asc" } });
  assert.ok(audit.some((entry) => entry.action === "DRAFT_UPDATED"));
  assert.ok(audit.some((entry) => entry.action === "DRAFT_DELETED"));
  const approvedAudit = audit.find((entry) => entry.action === "CHANGE_APPROVED");
  assert.equal(approvedAudit.actorLabel, "admin@example.test"); assert.ok(approvedAudit.evidence);
  await assert.rejects(db.adminAuditEntry.update({ where: { id: approvedAudit.id }, data: { action: "TAMPERED" } }), /append-only/);
  await assert.rejects(db.adminAuditEntry.delete({ where: { id: approvedAudit.id } }), /append-only/);
  assert.equal((await admin.json("/api/admin")).status, 200);
});
