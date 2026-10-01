import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error("Disposable test/integration DATABASE_URL required");
const db = new PrismaClient();
const slug = "due-worker-" + randomUUID().slice(0, 8);
let sourceId;
let dir;
let runIds = [];
const fixture = '<html><script type="application/ld+json">{"@type":"MusicEvent","startDate":"2027-07-07"}</script></html>';

function run(extra = [], output = path.join(dir, "out-" + randomUUID()), envExtra = {}) {
  return spawnSync(process.execPath, ["scripts/ingest-festivals.mjs", "--db-due", "--publish", ...(extra.some((value) => value.startsWith("--fixture=")) ? [] : ["--fixture=" + path.join(dir, "fixture.html")]), "--output=" + output, ...extra], {
    encoding: "utf8",
    env: { ...process.env, APP_URL: "", NOTIFICATION_EVENTS_URL: "", INTERNAL_API_SECRET: "", NOTIFICATION_DELIVERY_REQUIRED: "false", ...envExtra },
  });
}

test.before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "due-worker-"));
  await writeFile(path.join(dir, "fixture.html"), fixture);
  const festival = await db.festival.create({ data: {
    slug, name: "Worker Fixture", country: "Test", countryCode: "DE", officialUrl: "https://example.test/worker", genres: [],
    editions: { create: { year: 2027, status: "TBA", ticketStatus: "UNKNOWN", recordState: "CURRENT", completeness: "TBA", sourceUpdatedAt: new Date() } },
  } });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id } });
  const source = await db.festivalSource.create({ data: {
    festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: "https://example.test/worker",
    strategies: ["manual_review"], parserKey: "manual_review", refreshPolicy: "daily", cadenceSeconds: 86400,
    enabled: true, editionYear: 2027, configurationBackfilledAt: new Date(), nextRunAt: new Date(Date.now() - 1000),
  } });
  sourceId = source.id;
});
test.after(async () => {
  runIds = (await db.ingestionRun.findMany({ where: { attempts: { some: { festivalSlug: slug } } }, select: { id: true } })).map((row) => row.id);
  const candidates = await db.ingestionCandidate.findMany({ where: { runId: { in: runIds } }, select: { id: true } });
  const ids = candidates.map((row) => row.id);
  await db.ingestionDiff.deleteMany({ where: { candidateId: { in: ids } } });
  await db.ingestionEvidence.deleteMany({ where: { candidateId: { in: ids } } });
  await db.ingestionCandidate.deleteMany({ where: { id: { in: ids } } });
  await db.ingestionAttempt.deleteMany({ where: { runId: { in: runIds } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
  await db.ingestionSourceState.deleteMany({ where: { festivalSlug: slug } });
  await db.festivalSource.delete({ where: { id: sourceId } });
  await db.festival.delete({ where: { slug } });
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
});

test("opt-in worker acknowledges exactly one due source and leaves non-due runs idle", async () => {
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const summary = JSON.parse(first.stdout);
  assert.equal(summary.status, "COMPLETED");
  assert.equal(summary.attempted, 1);
  assert.equal(summary.published, 0);
  const completed = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(completed.leaseOwner, null);
  assert.equal(completed.consecutiveFailures, 0);
  assert.equal(completed.lastError, null);
  assert.ok(completed.nextRunAt > new Date());
  const idle = run();
  assert.equal(idle.status, 0, idle.stderr);
  assert.deepEqual(JSON.parse(idle.stdout), { status: "NO_DUE_SOURCES", attempted: 0 });
});

test("fetch failure persists an attempt and backs off before next claim", async () => {
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  const failed = run(["--fixture=" + path.join(dir, "missing.html")]);
  assert.equal(failed.status, 2, failed.stderr);
  const summary = JSON.parse(failed.stdout);
  assert.equal(summary.fetchErrors, 1);
  const row = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(row.leaseOwner, null);
  assert.equal(row.consecutiveFailures, 1);
  assert.equal(row.lastError, "fetch_error");
  assert.ok(row.nextRunAt > new Date());
  assert.equal(run().status, 0);
});

test("post-fetch local failure releases lease with parser backoff", async () => {
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  const output = path.join(dir, "blocked");
  await mkdir(path.join(output, slug + ".json"), { recursive: true });
  const failed = run([], output);
  assert.notEqual(failed.status, 0);
  const row = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(row.leaseOwner, null);
  assert.equal(row.lastError, "parser_error");
  assert.equal(row.consecutiveFailures, 2);
  assert.ok(row.nextRunAt > new Date());
  const latest = await db.ingestionRun.findFirstOrThrow({ where: { attempts: { some: { festivalSlug: slug } } }, orderBy: { startedAt: "desc" } });
  assert.equal(latest.status, "FAILED");
  assert.ok(latest.endedAt);
});


test("due mode rejects ambiguous manual controls without claiming", async () => {
  const before = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  const invalid = run(["--force"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--db-due requires database and --publish/);
  const after = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.deepEqual(after, before);
});

test("run creation failure releases claimed source without a RUNNING run", async () => {
  const marker = "fail-" + randomUUID();
  await db.festivalSource.update({ where: { id: sourceId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  // Disposable PostgreSQL: force INSERT failure only for this test invocation.
  await db.$executeRawUnsafe("CREATE FUNCTION due_worker_reject_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.\"sourceCommit\" = '" + marker + "' THEN RAISE EXCEPTION 'test run insert failure'; END IF; RETURN NEW; END $$");
  await db.$executeRawUnsafe('CREATE TRIGGER due_worker_reject_run BEFORE INSERT ON "IngestionRun" FOR EACH ROW EXECUTE FUNCTION due_worker_reject_run()');
  try {
    const failed = run([], undefined, { GITHUB_SHA: marker });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /test run insert failure/);
    const source = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
    assert.equal(source.leaseOwner, null);
    assert.equal(source.lastError, "parser_error");
    assert.equal(await db.ingestionRun.count({ where: { sourceCommit: marker } }), 0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER due_worker_reject_run ON "IngestionRun"');
    await db.$executeRawUnsafe('DROP FUNCTION due_worker_reject_run()');
  }
});

test("failed notification cannot retry committed publication", async () => {
  await db.festivalSource.update({ where: { id: sourceId }, data: {
    nextRunAt: new Date(Date.now() - 1000), strategies: ["json_ld_event"], parserKey: "json_ld_event",
  } });
  const failed = run([], undefined, {
    NOTIFICATION_EVENTS_URL: "http://127.0.0.1:1/events", INTERNAL_API_SECRET: "disposable-test-secret",
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /fetch failed|Notification event persistence failed/);
  const source = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.equal(source.leaseOwner, null);
  assert.equal(source.lastError, null);
  assert.equal(source.consecutiveFailures, 0);
  assert.ok(source.nextRunAt > new Date());
  const latest = await db.ingestionRun.findFirstOrThrow({ where: { attempts: { some: { festivalSlug: slug } } }, orderBy: { startedAt: "desc" } });
  assert.equal(latest.status, "FAILED");
  assert.ok(latest.endedAt);
  assert.equal(await db.catalogPublication.count({ where: { festivalSlug: slug, source: "INGESTION" } }), 1);
  assert.deepEqual(JSON.parse(run().stdout), { status: "NO_DUE_SOURCES", attempted: 0 });
});
