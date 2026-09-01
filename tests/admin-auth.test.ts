import assert from "node:assert/strict";
import test from "node:test";
import { accessStatus, requestHasTrustedOrigin, roleAllowed } from "../lib/admin-auth.ts";

test("ordinary users are denied while editors and administrators are allowed", () => {
  assert.equal(accessStatus(null), 401);
  assert.equal(accessStatus("USER"), 403);
  assert.equal(accessStatus("EDITOR"), 200);
  assert.equal(accessStatus("ADMIN"), 200);
  assert.equal(roleAllowed("USER"), false);
  assert.equal(roleAllowed("EDITOR"), true);
  assert.equal(roleAllowed("ADMIN"), true);
  assert.equal(roleAllowed("EDITOR", ["ADMIN"]), false);
  assert.equal(roleAllowed("ADMIN", ["ADMIN"]), true);
  assert.equal(accessStatus("EDITOR", ["ADMIN"]), 403);
});

test("administrative mutations require the configured same origin", () => {
  const same = new Request("https://radar.example/api/admin/actions", { headers: { origin: "https://radar.example" } });
  const forged = new Request("https://radar.example/api/admin/actions", { headers: { origin: "https://evil.example" } });
  const missing = new Request("https://radar.example/api/admin/actions");
  const opaque = new Request("https://radar.example/api/admin/actions", { headers: { origin: "null" } });
  const malformed = new Request("https://radar.example/api/admin/actions", { headers: { origin: "not-a-url" } });
  const pathOrigin = new Request("https://radar.example/api/admin/actions", { headers: { origin: "https://radar.example/path" } });
  assert.equal(requestHasTrustedOrigin(same, "https://radar.example"), true);
  assert.equal(requestHasTrustedOrigin(forged, "https://radar.example"), false);
  assert.equal(requestHasTrustedOrigin(missing, "https://radar.example"), false);
  assert.equal(requestHasTrustedOrigin(opaque, "https://radar.example"), false);
  assert.equal(requestHasTrustedOrigin(malformed, "https://radar.example"), false);
  assert.equal(requestHasTrustedOrigin(pathOrigin, "https://radar.example"), false);
  assert.equal(requestHasTrustedOrigin(same, "not-a-url"), false);
});
