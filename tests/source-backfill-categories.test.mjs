import assert from "node:assert/strict";
import test from "node:test";
import { festivalSources } from "../data/festival-sources.ts";
import { backfillSources, SourceBackfillReject } from "../lib/sources/repository.ts";
import { audit, runSourceBackfill } from "../scripts/deploy/run-source-backfill.ts";

const nonce = "c".repeat(64);
const source = festivalSources[0];
const festival = { id: "festival-id", slug: source.festivalSlug, editions: [{ id: "edition-id", year: source.editionYear }] };
const row = { festivalSlug: source.festivalSlug, url: source.url, festivalId: null, editionId: null,
  editionYear: source.editionYear, refreshPolicy: source.refreshPolicy, strategies: source.strategies,
  enabled: source.enabled, configurationBackfilledAt: null };

function fakeDb(festivals = [festival], existing = [], failure) {
  return {
    $queryRaw: async () => [{ count: 1n }],
    $transaction: async (callback) => callback({
      festival: { findMany: async () => { if (failure) throw failure; return festivals; } },
      festivalSource: { findMany: async () => existing, create: () => { throw new Error("unexpected write"); }, update: () => { throw new Error("unexpected write"); } },
    }),
  };
}

test("planning rejects have fixed typed codes independent of sensitive messages", async () => {
  const cases = [
    ["seed-validation", fakeDb(), [{ ...source, url: "secret://bad" }]],
    ["duplicate-source", fakeDb(), [source, source]],
    ["missing-enabled-festival", fakeDb([]), [source]],
    ["missing-edition", fakeDb([{ ...festival, editions: [] }]), [source]],
    ["binding-conflict", fakeDb([festival], [{ ...row, festivalId: "different" }]), [source]],
    ["binding-conflict", fakeDb([festival], [{ ...row, editionId: "different" }]), [source]],
    ["legacy-config-conflict", fakeDb([festival], [{ ...row, refreshPolicy: "weekly" }]), [source]],
    ["unresolved-drift", fakeDb([festival], [{ ...row, enabled: false, configurationBackfilledAt: new Date() }]), [source]],
  ];
  for (const [code, db, inventory] of cases) {
    await assert.rejects(backfillSources(db, inventory, { failOnDrift: true }), (error) => {
      assert.ok(error instanceof SourceBackfillReject);
      assert.equal(error.code, code);
      return true;
    }, code);
  }
  const unexpected = new Error("sensitive unexpected exception");
  await assert.rejects(backfillSources(fakeDb(), [{ ...source, get festivalSlug() { throw unexpected; } }], { dryRun: true }), (error) => {
    assert.equal(error, unexpected);
    assert.ok(!(error instanceof SourceBackfillReject));
    return true;
  });
});

test("runner never serializes exception messages or assumes error drift is zero", async () => {
  const sensitive = "postgresql://secret.example/db https://private.example/source";
  const migrationError = { $queryRaw: async () => { throw new Error(sensitive); } };
  for (const [db, category] of [
    [migrationError, "migration-check-error"],
    [fakeDb([], [], new Error("Missing source edition: " + sensitive)), "database-or-unknown-error"],
    [fakeDb(), "missing-enabled-festival"],
  ]) {
    const result = await runSourceBackfill(db, "preview", nonce);
    assert.equal(result.ok, false);
    assert.deepEqual(JSON.parse(result.output), { operation: "festival-source-backfill", mode: "preview", nonce, status: category, drift: null });
    assert.doesNotMatch(result.output, /secret|private|postgresql|https?:\/\//);
  }
  assert.throws(() => audit("preview", "arbitrary", nonce), /invalid source operation audit/);
  assert.throws(() => audit("preview", "missing-edition", nonce, undefined, 0), /invalid source operation audit shape/);
});
