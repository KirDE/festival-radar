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
    ["legacy-config-conflict", fakeDb([festival], [{ ...row, refreshPolicy: source.refreshPolicy === "weekly" ? "daily" : "weekly" }]), [source]],
    ["unresolved-drift", fakeDb([festival], [{ ...row, enabled: false, configurationBackfilledAt: new Date() }]), [source]],
  ];
  for (const [code, db, inventory] of cases) {
    await assert.rejects(backfillSources(db, inventory, { failOnDrift: true }), (error) => {
      assert.ok(error instanceof SourceBackfillReject);
      assert.equal(error.code, code);
      assert.deepEqual(error.conflictSummary, code === "legacy-config-conflict"
        ? { affectedRows: 1, editionYear: 0, refreshPolicy: 1, strategies: 0 } : undefined);
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

test("complete conflict scan counts each differing field and rejects before writes", async () => {
  const inventory = festivalSources.slice(0, 3);
  const festivals = inventory.map((item, index) => ({ id: "festival-" + index, slug: item.festivalSlug,
    editions: [{ id: "edition-" + index, year: item.editionYear }] }));
  const [first, second] = inventory;
  const existing = [
    { ...row, festivalSlug: first.festivalSlug, url: first.url, editionYear: first.editionYear + 1,
      refreshPolicy: first.refreshPolicy, strategies: first.strategies },
    { ...row, festivalSlug: second.festivalSlug, url: second.url, editionYear: second.editionYear,
      refreshPolicy: second.refreshPolicy === "weekly" ? "daily" : "weekly", strategies: ["manual_review"] },
  ];
  const expected = { affectedRows: 2, editionYear: 1, refreshPolicy: 1, strategies: 1 };
  for (const options of [{ dryRun: true }, { dryRun: false, failOnDrift: true }]) {
    await assert.rejects(backfillSources(fakeDb(festivals, existing), inventory, options), (error) => {
      assert.equal(error.code, "legacy-config-conflict");
      assert.deepEqual(error.conflictSummary, expected);
      return true;
    });
  }
  for (const extra of [second, { ...second, url: "invalid://secret" }]) {
    await assert.rejects(backfillSources(fakeDb(festivals, existing), [...inventory, extra], { dryRun: true }), (error) => {
      assert.equal(error.code, extra === second ? "duplicate-source" : "seed-validation");
      assert.equal(error.conflictSummary, undefined);
      return true;
    });
  }
});

test("runner emits only fixed numeric conflict summary", async () => {
  const festivals = festivalSources.filter((item) => item.enabled).map((item, index) => ({
    id: "festival-" + index, slug: item.festivalSlug, editions: [{ id: "edition-" + index, year: item.editionYear }],
  }));
  const [first, second] = festivalSources;
  const existing = [
    { ...row, festivalSlug: first.festivalSlug, url: first.url, editionYear: first.editionYear + 1, strategies: first.strategies, refreshPolicy: first.refreshPolicy },
    { ...row, festivalSlug: second.festivalSlug, url: second.url, editionYear: second.editionYear, strategies: ["manual_review"], refreshPolicy: "weekly" },
  ];
  for (const mode of ["preview", "apply"]) {
    const result = await runSourceBackfill(fakeDb(festivals, existing), mode, nonce);
    assert.equal(result.ok, false);
    assert.deepEqual(JSON.parse(result.output), { operation: "festival-source-backfill", mode, nonce,
      status: "legacy-config-conflict", conflictSummary: { affectedRows: 2, editionYear: 1, refreshPolicy: 1, strategies: 1 }, drift: null });
    assert.doesNotMatch(result.output, /https?:\/\/|festivalSlug|"url"|"counts"/);
  }
  const sensitive = { affectedRows: 1, editionYear: 1, refreshPolicy: 0, strategies: 0, url: "https://secret.example" };
  assert.doesNotMatch(audit("preview", "legacy-config-conflict", nonce, undefined, undefined, sensitive), /secret|url/);
  for (const summary of [undefined, { ...sensitive, affectedRows: 0 }, { ...sensitive, editionYear: NaN }, { ...sensitive, editionYear: 2 }]) {
    assert.throws(() => audit("preview", "legacy-config-conflict", nonce, undefined, undefined, summary), /invalid source operation audit shape/);
  }
  assert.throws(() => audit("preview", "legacy-config-conflict", nonce, { insert: 0, fill: 0, preserve: 0 }, undefined, sensitive), /invalid source operation audit shape/);
  assert.throws(() => audit("preview", "missing-edition", nonce, undefined, undefined, sensitive), /invalid source operation audit shape/);
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
