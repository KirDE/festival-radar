import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) throw new Error("A test DATABASE_URL is required");
const db = new PrismaClient();
const port = 3244;
const origin = `http://127.0.0.1:${port}`;
let app;

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
  await db.adminChange.deleteMany(); await db.adminDraft.deleteMany(); await db.adminParserRun.deleteMany(); await db.adminResourceState.deleteMany(); await db.session.deleteMany(); await db.adminAuditEntry.deleteMany().catch(() => {}); await db.user.deleteMany();
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], { env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_SECRET: "admin-integration-secret-at-least-32", ADMIN_EMAILS: "admin@example.test" }, stdio: "ignore" });
  for (let attempt = 0; attempt < 120; attempt += 1) { try { if ((await fetch(origin)).status < 500) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); }
  throw new Error("Integration server did not start");
});
test.after(async () => { if (app?.exitCode === null) { app.kill("SIGTERM"); await once(app, "exit"); } await db.$disconnect(); });

test("persisted admin drafts, decisions, conflicts, authorization and audit invariants", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.json("/api/admin")).status, 403);
  const admin = new Client();
  assert.equal((await admin.json("/api/auth/register", "POST", { email: "admin@example.test", password: "correct horse battery staple" })).status, 201);
  const draftResponse = await admin.json("/api/admin", "POST", { resourceKind: "festival", resourceKey: "wacken-open-air", baseRevision: 0, values: { city: "Wacken Preview", status: "confirmed" } });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal(await db.adminChange.count({ where: { draftId: draft.id } }), 2);
  const city = await db.adminChange.findFirstOrThrow({ where: { draftId: draft.id, field: "city" } });
  assert.equal((await admin.json(`/api/admin/changes/${city.id}`, "POST", { decision: "approve" })).status, 200);
  assert.deepEqual((await db.adminResourceState.findUniqueOrThrow({ where: { resourceKind_resourceKey: { resourceKind: "FESTIVAL", resourceKey: "wacken-open-air" } } })).values, { city: "Wacken Preview" });
  assert.equal((await admin.json("/api/admin", "POST", { resourceKind: "festival", resourceKey: "wacken-open-air", baseRevision: 0, values: { city: "stale" } })).status, 409);
  const status = await db.adminChange.findFirstOrThrow({ where: { draftId: draft.id, field: "status" } });
  assert.equal((await admin.json(`/api/admin/changes/${status.id}`, "POST", { decision: "reject" })).status, 200);
  assert.equal((await db.adminResourceState.findUniqueOrThrow({ where: { resourceKind_resourceKey: { resourceKind: "FESTIVAL", resourceKey: "wacken-open-air" } } })).values.city, "Wacken Preview");
  const audit = await db.adminAuditEntry.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(audit.map((entry) => entry.action), ["DRAFT_SAVED", "CHANGE_APPROVED", "CHANGE_REJECTED"]);
  assert.equal(audit[1].actorLabel, "admin@example.test"); assert.equal(audit[1].afterValue, "Wacken Preview"); assert.ok(audit[1].evidence);
  await assert.rejects(db.adminAuditEntry.update({ where: { id: audit[1].id }, data: { action: "TAMPERED" } }), /append-only/);
  assert.equal((await admin.json("/api/admin")).status, 200);
});
