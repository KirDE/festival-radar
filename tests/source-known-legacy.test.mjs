import assert from "node:assert/strict";
import test from "node:test";
import { festivalSources } from "../data/festival-sources.ts";
import { backfillSources, SourceBackfillReject } from "../lib/sources/repository.ts";
import { runSourceBackfill } from "../scripts/deploy/run-source-backfill.ts";

const indices = [23, 41, 45];
const oldPolicies = ["daily", "every_3_days", "weekly"];
const nonce = "d".repeat(64);
const inventory = indices.map((index) => festivalSources[index]);
const festivals = festivalSources.map((source, index) => ({ id: "f-" + index, slug: source.festivalSlug,
  editions: [{ id: "e-" + index, year: source.editionYear }] }));
function oldRow(index, position) {
  const source = festivalSources[index];
  return { id: "row-" + index, festivalSlug: source.festivalSlug, url: source.url,
    strategies: ["json_ld_event", "html_fallback"], refreshPolicy: oldPolicies[position],
    enabled: true, editionYear: 2027, festivalId: "f-" + index, editionId: null,
    parserKey: null, fetchUrl: null, followLinkPattern: null, requestHeaders: null,
    manualReviewReason: null, cadenceSeconds: null, configurationBackfilledAt: null,
    nextRunAt: null, consecutiveFailures: 0, lastError: null, lastAttemptAt: null,
    lastSuccessAt: null, leaseOwner: null, leaseExpiresAt: null, httpEtag: null,
    httpLastModified: null, createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01") };
}
const original = () => indices.map(oldRow);
function database(initial, { failWriteAt = 0, mutateBeforeWrite = false } = {}) {
  let rows = structuredClone(initial);
  let writes = 0;
  return {
    get rows() { return structuredClone(rows); },
    get writes() { return writes; },
    $queryRaw: async () => [{ count: 1n }],
    $transaction: async (callback, options) => {
      assert.equal(options.isolationLevel, "Serializable");
      let draft = structuredClone(rows);
      const result = await callback({
        $queryRaw: async () => draft.map(({ id }) => ({ id })),
        festival: { findMany: async () => festivals },
        festivalSource: {
          findMany: async () => structuredClone(draft),
          create: async ({ data }) => { writes++; if (writes === failWriteAt) throw new Error("injected write failure");
            draft.push({ ...data, id: "insert-" + writes, festivalId: data.festival?.connect.id ?? null,
              editionId: data.edition?.connect.id ?? null, fetchUrl: data.fetchUrl ?? null,
              followLinkPattern: data.followLinkPattern ?? null, requestHeaders: data.requestHeaders ?? null,
              manualReviewReason: data.manualReviewReason ?? null }); },
          updateMany: async ({ where, data }) => {
            writes++;
            if (writes === failWriteAt) throw new Error("injected write failure");
            if (mutateBeforeWrite) return { count: 0 };
            const row = draft.find((item) => item.id === where.id &&
              item.updatedAt?.getTime() === where.updatedAt?.getTime() && item.configurationBackfilledAt === null);
            if (!row) return { count: 0 };
            Object.assign(row, data);
            row.updatedAt = new Date("2026-10-01");
            return { count: 1 };
          },
        },
      });
      rows = draft;
      return result;
    },
  };
}
const productionInventory = festivalSources; // real full-list ordinals, not a filtered custom allowlist

test("protected preview plans all three old tuples without writes or sensitive audit output", async () => {
  const db = database(original());
  const before = db.rows;
  const preview = await runSourceBackfill(db, "preview", nonce);
  assert.equal(preview.ok, true);
  const audit = JSON.parse(preview.output);
  assert.equal(audit.status, "ok");
  assert.deepEqual(audit.counts, { insert: productionInventory.length - 3, fill: 3, preserve: 0 });
  assert.equal(audit.drift, 0);
  assert.equal(db.writes, 0);
  assert.deepEqual(db.rows, before);
  assert.doesNotMatch(preview.output, /https?:\/\/|festivalSlug|"url"|row-23/);
});

test("apply changes only exact legacy config, marks rows, then is idempotent", async () => {
  const db = database(original());
  const report = await backfillSources(db, productionInventory, { dryRun: true, failOnDrift: true, reconcileKnownLegacy: true });
  assert.deepEqual(report.counts, { insert: productionInventory.length - 3, fill: 3, preserve: 0 });
  assert.equal(report.ok, true);
  assert.equal(db.writes, 0);
  const applied = await backfillSources(db, inventory, { reconcileKnownLegacy: false, dryRun: true }).catch((error) => error);
  assert.equal(applied.code, "legacy-config-conflict");
  await backfillSources(db, productionInventory, { failOnDrift: true, reconcileKnownLegacy: true });
  for (const index of indices) {
    const row = db.rows.find((item) => item.id === "row-" + index);
    const source = festivalSources[index];
    assert.deepEqual(row.strategies, source.strategies);
    assert.equal(row.refreshPolicy, "daily");
    assert.equal(row.fetchUrl, source.fetchUrl ?? null);
    assert.equal(row.followLinkPattern, source.followLinkPattern ?? null);
    assert.equal(row.parserKey, "official_markup:" + source.festivalSlug);
    assert.equal(row.editionId, "e-" + index);
    assert.equal(row.enabled, true);
    assert.equal(row.editionYear, 2027);
    assert.ok(row.configurationBackfilledAt);
    assert.equal(row.festivalId, "f-" + index);
  }
  const after = db.rows;
  const repeat = await backfillSources(db, productionInventory, { failOnDrift: true, reconcileKnownLegacy: true });
  assert.deepEqual(repeat.counts, { insert: 0, fill: 0, preserve: productionInventory.length });
  assert.deepEqual(db.rows, after);
});

test("mismatched tuple, enabled, binding, parser and other non-null state fail closed", async () => {
  const changes = [
    [0, { refreshPolicy: "weekly" }, "legacy-config-conflict"],
    [1, { strategies: ["html_fallback", "json_ld_event"] }, "legacy-config-conflict"],
    [2, { enabled: false }, "legacy-config-conflict"],
    [1, { editionYear: 2028 }, "legacy-config-conflict"],
    [0, { editionId: "wrong-edition" }, "binding-conflict"],
    [0, { editionId: "e-23" }, "legacy-config-conflict"],
    [1, { parserKey: "operator" }, "legacy-config-conflict"],
    [1, { fetchUrl: "https://private.example/operator" }, "legacy-config-conflict"],
    [2, { cadenceSeconds: 86400 }, "legacy-config-conflict"],
    [2, { nextRunAt: new Date() }, "legacy-config-conflict"],
    [2, { configurationBackfilledAt: new Date() }, "unresolved-drift"],
  ];
  for (const [position, patch, expected] of changes) {
    const rows = original(); Object.assign(rows[position], patch);
    const db = database(rows);
    const result = await runSourceBackfill(db, "apply", nonce);
    assert.equal(JSON.parse(result.output).status, expected);
    assert.equal(db.writes, 0);
    assert.deepEqual(db.rows, rows);
    assert.doesNotMatch(result.output, /https?:\/\/|festivalSlug|"url"|operator/);
  }
});

test("other unmarked or marked drift is detected before writes, preview reports drift", async () => {
  const rows = original();
  rows.push({ ...oldRow(0, 0), id: "other", url: "https://other.example/", enabled: false,
    strategies: festivalSources[0].strategies, refreshPolicy: festivalSources[0].refreshPolicy,
    configurationBackfilledAt: new Date() });
  const db = database(rows);
  const custom = [...festivalSources, { ...festivalSources[0], url: "https://other.example/" }];
  const preview = await backfillSources(db, custom, { dryRun: true, failOnDrift: true, reconcileKnownLegacy: true });
  assert.equal(preview.ok, false);
  assert.deepEqual(preview.counts, { insert: festivalSources.length - 3, fill: 3, preserve: 1 });
  assert.deepEqual(preview.plan.at(-1).drift, ["enabled"]);
  await assert.rejects(backfillSources(db, custom, { failOnDrift: true, reconcileKnownLegacy: true }),
    (error) => error instanceof SourceBackfillReject && error.code === "unresolved-drift");
  assert.equal(db.writes, 0);
  assert.deepEqual(db.rows, rows);
});

test("unmarked unrelated drift blocks the three transitions before any write", async () => {
  const rows = original();
  rows.push({ ...oldRow(0, 0), strategies: festivalSources[0].strategies,
    refreshPolicy: festivalSources[0].refreshPolicy, parserKey: "operator-parser" });
  const db = database(rows);
  const preview = await runSourceBackfill(db, "preview", nonce);
  assert.equal(JSON.parse(preview.output).status, "review-required");
  assert.equal(JSON.parse(preview.output).drift, 1);
  const apply = await runSourceBackfill(db, "apply", nonce);
  assert.equal(JSON.parse(apply.output).status, "unresolved-drift");
  assert.equal(db.writes, 0);
  assert.deepEqual(db.rows, rows);
});

test("modified target inventory URL or new configuration cannot reuse historical permission", async () => {
  const cases = [
    [23, { url: "https://other.example/" }],
    [23, { fetchUrl: "https://other.example/lineup" }],
    [41, { refreshPolicy: "weekly" }],
    [45, { followLinkPattern: "^/other$" }],
  ];
  for (const [index, patch] of cases) {
    const changed = festivalSources.map((source, position) => position === index ? { ...source, ...patch } : source);
    const db = database(original());
    // If the URL changes the old row is outside this inventory and remains untouched.
    const result = await backfillSources(db, changed, { dryRun: true, failOnDrift: true, reconcileKnownLegacy: true }).catch((error) => error);
    if (patch.url) {
      assert.equal(result.ok, true);
      assert.equal(result.counts.insert, festivalSources.length - 2);
    } else assert.equal(result.code, "legacy-config-conflict");
    assert.equal(db.writes, 0);
    assert.deepEqual(db.rows, original());
  }
});

test("failed CAS or later write rolls back the entire transaction", async () => {
  for (const config of [{ mutateBeforeWrite: true }, { failWriteAt: 3 }]) {
    const db = database(original(), config);
    const before = db.rows;
    await assert.rejects(backfillSources(db, productionInventory, { failOnDrift: true, reconcileKnownLegacy: true }));
    assert.deepEqual(db.rows, before);
  }
});
