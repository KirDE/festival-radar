import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/db.ts";
import { POST } from "../app/api/operations/rockharz-2027-update/route.ts";
import { ACTIVATION, artistCollisionKey, PLAN, PLAN_HASH, PROVENANCE, REVIEW_EXPIRES_AT, URLS, validateNames } from "../lib/operations/rockharz-2027-plan.ts";
import { ARTIST_READ_LIMIT, guardedRockharzUpdate, resolveArtistIdentities } from "../lib/operations/rockharz-2027-update.ts";

const commit = "a".repeat(40), token = "b".repeat(64);
const input = { operation: "inspect" as const, expectedCommit: commit, planHash: PLAN_HASH, runId: "123:1" };
test("reviewed tile titles retain conservative identity omissions and independent headline evidence", () => {
  assert.equal(PLAN.lineup.length, 26);
  assert.deepEqual(PLAN.headliners, ["Amon Amarth"]);
  assert.equal(PLAN.omitted.length, 3);
  assert.equal(PLAN.tilesVerified.titledTileCount, 29);
  assert.deepEqual(PLAN.omitted.map((o) => o.tileTitle), ["GRAVE DIGGER", "DARTAGNAN", "SKALD"]);
  assert.ok(!PLAN.lineup.some((n) => /digger|dartagnan|sk.ld/i.test(n)));
  assert.equal(PROVENANCE.find((p) => p.field === "headliners")?.url, URLS.headliner);
  assert.equal(PROVENANCE.find((p) => p.field === "lineup")?.url, URLS.wave);
  validateNames([...PLAN.headliners, ...PLAN.lineup]);
  assert.throws(() => validateNames(["Accept", "ACCEPT"]));
  assert.throws(() => validateNames(["A B", "A-B"]));
  assert.throws(() => validateNames(["SETYOURSAILS", "SETYØURSAILS"]));
  assert.equal(artistCollisionKey("D’Àrtagnan"), artistCollisionKey("D'Artagnan"));
  assert.equal(artistCollisionKey("SKĀLD"), artistCollisionKey("SKALD"));
});

test("folded names and aliases detect collisions without authorizing reuse", () => {
  const row = { id: "one", name: "D'Artagnan", slug: "dartagnan-existing", aliases: [], identityState: "UNRESOLVED" as const };
  assert.throws(() => resolveArtistIdentities([row], ["D’Artagnan"]), /requires review/);
  assert.throws(() => resolveArtistIdentities([{ ...row, name: "Other", aliases: ["D’Àrtagnan"] }], ["D'Artagnan"]), /requires review/);
  assert.throws(() => resolveArtistIdentities([row, { ...row, id: "two", name: "DARTAGNAN", slug: "second" }], ["D'Artagnan"]), /ambiguity/);
  assert.equal(resolveArtistIdentities([{ ...row, aliases: ["D’Artagnan", "DARTAGNAN"] }], ["D'Artagnan"])[0].id, row.id);
  assert.throws(() => resolveArtistIdentities([], ["SETYØURSAILS"]), /existing exact identity/);
  assert.equal(resolveArtistIdentities([{ ...row, name: "SETYØURSAILS", aliases: ["SETYOURSAILS"] }], ["SETYØURSAILS"])[0].id, row.id);
  assert.throws(() => resolveArtistIdentities(Array(ARTIST_READ_LIMIT + 1).fill(row), ["D'Artagnan"]), /bounded/);
});

test("activation, digest and review window are checked before opening a transaction", async () => {
  let calls = 0;
  const fake = { $transaction() { calls++; throw new Error("must not open"); } } as unknown as typeof db;
  const now = new Date("2026-10-08T12:00:00Z");
  for (const request of [ { ...input, operation: "activate" as const }, { ...input, planHash: "0".repeat(64) },
    { ...input, expectedCommit: "58abc7c9" }, { ...input, runId: "untrusted" } ]) {
    await assert.rejects(guardedRockharzUpdate(fake, request, now));
  }
  await assert.rejects(guardedRockharzUpdate(fake, input, REVIEW_EXPIRES_AT), /expired/);
  assert.equal(calls, 0);
});

test("protected route fails closed without DB access", async () => {
  const previous = { ...process.env };
  const original = db.$transaction;
  let calls = 0;
  db.$transaction = (async () => { calls++; throw new Error("private DB diagnostic must never appear"); }) as typeof db.$transaction;
  const request = (body: unknown = input, authorization: string = `Bearer ${token}`, contentType = "application/json") =>
    new Request("https://app.example/api/operations/rockharz-2027-update/", { method: "POST",
      headers: { authorization, "content-type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body) });
  try {
    process.env.DEPLOYED_COMMIT = commit;
    process.env.INTERNAL_API_SECRET = "c".repeat(64);
    delete process.env.ROCKHARZ_2027_UPDATE_TOKEN;
    assert.equal((await POST(request())).status, 401);
    process.env.ROCKHARZ_2027_UPDATE_TOKEN = token;
    delete process.env.ROCKHARZ_2027_UPDATE_ACTIVATION;
    assert.equal((await POST(request())).status, 401);
    process.env.ROCKHARZ_2027_UPDATE_ACTIVATION = ACTIVATION;
    for (const credential of ["", `Bearer ${"c".repeat(64)}`, `Bearer ${"d".repeat(64)}`, `Bearer ${"é".repeat(64)}`]) {
      assert.equal((await POST(request(input, credential))).status, 401);
    }
    process.env.INTERNAL_API_SECRET = token;
    assert.equal((await POST(request())).status, 401);
    process.env.INTERNAL_API_SECRET = "c".repeat(64);
    assert.equal((await POST(request(input, `Bearer ${token}`, "text/plain"))).status, 415);
    assert.equal((await POST(request("{"))).status, 400);
    assert.equal((await POST(request({ ...input, festival: "other" }))).status, 400);
    assert.equal((await POST(request({ ...input, expectedCommit: "d".repeat(40) }))).status, 409);
    assert.equal((await POST(request("x".repeat(1025)))).status, 413);
    assert.equal((await POST(request({ ...input, operation: "activate" }))).status, 409);
    assert.equal(calls, 0);
    const failure = await POST(request({ ...input, operation: "readback" }));
    assert.equal(failure.status, 500);
    assert.equal(failure.headers.get("cache-control"), "no-store");
    assert.ok(!(await failure.text()).includes("private DB diagnostic"));
    assert.equal(calls, 1);
  } finally {
    db.$transaction = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await db.$disconnect();
  }
});

test("workflow client inspects without mutation and never retries a lost activation response", async () => {
  const previous = { ...process.env }, originalFetch = globalThis.fetch, originalLog = console.log, originalError = console.error;
  const previousExit = process.exitCode;
  const calls: string[] = [];
  const output: string[] = [];
  let loseActivation = false;
  try {
    Object.assign(process.env, { APP_URL: "https://app.example/", ROCKHARZ_2027_UPDATE_TOKEN: token,
      GITHUB_SHA: commit, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", ROCKHARZ_ACTIVATION: ACTIVATION });
    console.log = (value) => { output.push(String(value)); };
    console.error = () => {};
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      calls.push(body.operation);
      assert.equal(options?.redirect, "error");
      assert.equal(body.planHash, PLAN_HASH);
      if (body.operation === "activate") {
        assert.equal(body.activation, ACTIVATION);
        if (loseActivation) throw new Error("lost response");
      }
      return Response.json({ status: body.operation === "inspect" ? "READY" : "VERIFIED", operation: "UPDATE_EXISTING",
        commit, planHash: PLAN_HASH, editionId: "existing-edition", announced: 27, playlistJobs: 0,
        reusedArtists: 1, newArtists: 26, headliners: 1, lineup: 26, sources: 5, provenance: 9,
        festivalSlug: "rockharz", editionYear: 2027, auditId: "audit-id", publicationId: "publication-id",
        playlistRefreshRequested: false, unexpectedPrivateData: "must not print" });
    };
    const script = new URL("../scripts/rockharz-2027-update.mjs", import.meta.url).href;
    process.env.ROCKHARZ_OPERATION = "inspect";
    await import(`${script}?inspect-test`);
    assert.deepEqual(calls, ["inspect"]);
    assert.ok(!output.join("").includes("must not print"));
    calls.length = 0;
    process.env.ROCKHARZ_OPERATION = "activate";
    loseActivation = true;
    await import(`${script}?lost-response-test`);
    assert.deepEqual(calls, ["inspect", "activate"]);
    assert.equal(process.exitCode, 1);
    calls.length = 0;
    process.exitCode = undefined;
    process.env.ROCKHARZ_OPERATION = "readback";
    await import(`${script}?readback-test`);
    assert.deepEqual(calls, ["readback"]);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = previousExit;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
