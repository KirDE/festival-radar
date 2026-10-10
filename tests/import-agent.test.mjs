import test from "node:test";
import assert from "node:assert/strict";
import {
  agentAuthorized,
  decisionSchema,
  fingerprint,
} from "../lib/ingestion/agent-contract.ts";
import {
  watcherDecision,
  privateJson,
  callAgent,
} from "../scripts/import-agent-client.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("separate bearer authorization fails closed and compares complete values", () => {
  const secret = "s".repeat(64),
    request = (value) =>
      new Request("https://example.test/", {
        headers: { authorization: value },
      });
  assert.equal(agentAuthorized(request("Bearer " + secret), secret), true);
  for (const value of [
    "Basic " + secret,
    "Bearer " + secret + "x",
    "Bearer " + "a".repeat(64),
    "Bearer ",
  ])
    assert.equal(agentAuthorized(request(value), secret), false);
  assert.equal(agentAuthorized(request("Bearer " + secret), ""), false);
});
test("strict decisions reject partial billing, impossible dates and unaudited writes", () => {
  const base = {
    action: "apply",
    reason: "Officially checked announcement",
    evidence: [
      {
        field: "city",
        url: "https://example.test/",
        checkedAt: new Date().toISOString(),
        contentHash: "a".repeat(64),
        excerpt: "2027 City",
      },
    ],
  };
  assert.equal(
    decisionSchema.safeParse({ ...base, facts: { city: "City" } }).success,
    true,
  );
  for (const facts of [
    { headliners: ["X"] },
    { startDate: "2027-02-29" },
    { status: "cancelled" },
    { city: "City", editionYear: 2028 },
  ])
    assert.equal(decisionSchema.safeParse({ ...base, facts }).success, false);
  assert.equal(
    decisionSchema.safeParse({ ...base, evidence: [] }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({
      action: "retry",
      reason: base.reason,
      facts: { city: "City" },
    }).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse({ action: "needs_user", reason: base.reason })
      .success,
    false,
  );
});
test("semantic fingerprints sort keys, preserve billing order and include timestamps", () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(fingerprint(["A", "B"]), fingerprint(["B", "A"]));
  assert.notEqual(fingerprint(new Date(0)), fingerprint(new Date(1000)));
});
test("watcher is quiet while healthy; new work, stranded work and failures wake the agent", () => {
  const now = 10000000,
    empty = { complete: true, ready: 0, revision: "a".repeat(64) },
    work = { ...empty, ready: 1, revision: "b".repeat(64) };
  const idle = watcherDecision(empty, {}, now);
  assert.equal(idle.fire, false);
  const active = watcherDecision(work, idle.state, now);
  assert.equal(active.fire, true);
  assert.equal(watcherDecision(work, active.state, now + 60000).fire, false);
  assert.equal(watcherDecision(work, active.state, now + 900001).fire, true);
  const failure = watcherDecision({ error: true }, active.state, now);
  assert.equal(failure.fire, true);
  assert.equal(
    watcherDecision({ error: true }, failure.state, now + 60000).fire,
    false,
  );
  assert.equal(
    watcherDecision({ error: true }, failure.state, now + 3600001).fire,
    true,
  );
  assert.throws(() => watcherDecision({ ready: 0 }, {}), /Incomplete/);
});
test("client refuses plaintext endpoints and world-readable credentials", async () => {
  await assert.rejects(
    callAgent({ baseUrl: "http://example.test/", token: "s".repeat(64) }),
    /Invalid/,
  );
  const dir = await mkdtemp(join(tmpdir(), "agent-config-"));
  const file = join(dir, "config.json");
  try {
    await writeFile(file, "{}", { mode: 0o644 });
    await assert.rejects(privateJson(file), /permissions/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
