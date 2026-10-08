import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { requireLocalDisposableDatabase } from "./support/disposable-db.ts";
import { novaDraftFixture } from "./support/novarock-review-draft-fixture.ts";
import { novaContentFixture } from "./support/novarock-content-fixture.ts";
import { captureAcquisitionProvenance } from "../lib/ingestion/provenance.ts";
import { createIngestionRun, persistAttempt, finishIngestionRun } from "../lib/ingestion/repository.ts";
import { sealNovaRockContent } from "../lib/ingestion/novarock-content-seal.ts";

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const origin = "http://127.0.0.1:32779";
const path = "/api/admin/novarock/raw-capture";
const fixturePath = fileURLToPath(new URL("./fixtures/official-markup/novarock-lineup-2027.html", import.meta.url));
const preload = fileURLToPath(new URL("./support/novarock-capture-https-double.cjs", import.meta.url));
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

// Fresh DB, synthetic review lineage and mocked HTTPS in server subprocess.
// Neither bytes nor timestamps are injected into the production route.
test(process.env.NOVA_CAPTURE_COMPETE_ONLY === "1" ? "isolated PG: simultaneous first-capture inserts" :
  process.env.NOVA_CAPTURE_RACE_ONLY === "1" ? "isolated PG: writer-first source generation race" :
  "isolated PG: authenticated raw capture, adversarial guards and writer-first races", { timeout: 90000 }, async () => {
  let server: ReturnType<typeof spawn> | undefined;
  let serverLog = "";
  const barrier = mkdtempSync(join(tmpdir(), "nova-capture-e2e-"));
  try {
    const fixture = novaDraftFixture();
    assert.equal(await db.ingestionAttempt.count({ where: { festivalSlug: "nova-rock" } }), 0);
    assert.equal(await db.festival.count({ where: { slug: "nova-rock" } }), 0);
    await db.festival.create({ data: fixture.festival });
    await db.festivalEdition.create({ data: fixture.edition });
    for (const { identities: _identities, links: _links, provenance: _provenance, ...a } of fixture.artists) await db.artist.create({ data: a });
    await db.lineupEntry.createMany({ data: fixture.lineup });
    const source = await db.festivalSource.create({ data: {
      id: fixture.draft.sourceId, festivalId: fixture.festival.id, festivalSlug: "nova-rock",
      editionId: fixture.edition.id, editionYear: 2027, url: "https://www.novarock.at/lineup/",
      parserKey: "official_markup:nova-rock", strategies: ["official_markup"], refreshPolicy: "daily",
      cadenceSeconds: 86400, configurationGeneration: 1, leaseVersion: 1,
      configurationBackfilledAt: new Date("2026-10-08T00:00:00Z"),
    }, include: { edition: true } });
    const provenance = captureAcquisitionProvenance({ ...source, leaseOwner: "12345678-1234-4234-8234-123456789012" });
    const { result } = novaContentFixture();
    const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: "synthetic-unattested", totalSources: 1 });
    const attempt = await persistAttempt(db, { runId: run.id, festivalSlug: "nova-rock", requestedUrl: source.url,
      finalUrl: source.url, httpStatus: 200, durationMs: 1, startedAt: new Date("2026-10-08T00:00:00Z"),
      endedAt: new Date("2026-10-08T00:00:01Z"), acquisitionProvenance: provenance, result });
    await finishIngestionRun(db, run.id);
    const candidate = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
    const seal = await sealNovaRockContent(db, candidate.id);
    const user = await db.user.create({ data: { email: "capture-admin@example.test", role: "ADMIN" } });
    const token = "synthetic-test-session-only";
    const session = await db.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 600000) } });
    async function snapshot() { return json({
      run: await db.ingestionRun.findUniqueOrThrow({ where: { id: run.id } }),
      attempt: await db.ingestionAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
      candidate: await db.ingestionCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      evidence: await db.ingestionEvidence.findMany({ where: { candidateId: candidate.id }, orderBy: { id: "asc" } }),
      diffs: await db.ingestionDiff.findMany({ where: { candidateId: candidate.id }, orderBy: { id: "asc" } }),
      source: await db.festivalSource.findUniqueOrThrow({ where: { id: source.id } }),
      festival: await db.festival.findMany({ orderBy: { id: "asc" } }),
      edition: await db.festivalEdition.findMany({ orderBy: { id: "asc" } }),
      lineup: await db.lineupEntry.findMany({ orderBy: { id: "asc" } }),
      artists: await db.artist.findMany({ orderBy: { id: "asc" } }),
      publication: await db.catalogPublication.findMany({ orderBy: { id: "asc" } }),
      ingestionOutbox: await db.ingestionNotificationOutbox.findMany({ orderBy: { id: "asc" } }),
      spotifyConnections: await db.spotifyConnection.findMany({ orderBy: { id: "asc" }, select: { id: true, userId: true } }),
      queue: await db.catalogPlaylistRefresh.findMany({ orderBy: { id: "asc" } }),
      playlist: await db.festivalPlaylist.findMany({ orderBy: { id: "asc" } }),
    }); }
    const before = await snapshot();
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-H", "127.0.0.1", "-p", "32779"], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, APP_URL: origin,
        ADMIN_EMAILS: user.email, AUTH_SECRET: "synthetic-test-auth-secret-at-least-32-chars",
        NODE_OPTIONS: "--require=" + preload, NOVA_CAPTURE_TEST_FIXTURE: fixturePath, NOVA_CAPTURE_TEST_BARRIER_DIR: barrier },
    });
    server.stdout?.on("data", (chunk) => { serverLog = (serverLog + String(chunk)).slice(-4000); });
    server.stderr?.on("data", (chunk) => { serverLog = (serverLog + String(chunk)).slice(-4000); });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) break;
      try { const r = await fetch(origin + "/api/auth/me"); if (r.status < 500) { ready = true; break; } } catch {}
      await new Promise((done) => setTimeout(done, 250));
    }
    assert.ok(ready, "isolated local Next server started: " + serverLog);
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(origin + path, { method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "festival_radar_session=" + token, Origin: origin, ...headers },
      body: JSON.stringify(body) });
    assert.equal((await post({ sealId: seal.id }, { Origin: "" })).status, 403);
    assert.equal((await post({ sealId: seal.id, reviewerId: user.id })).status, 400);
    assert.equal((await post({ sealId: seal.id, rawBytes: "forged" })).status, 400);
    const rawPost = (body: string) => fetch(origin + path, { method: "POST", headers: {
      "Content-Type": "application/json", Cookie: "festival_radar_session=" + token, Origin: origin }, body });
    assert.equal((await rawPost('{"sealId":"fake","sealId":"' + seal.id + '"}')).status, 400);
    assert.equal((await rawPost(JSON.stringify({ sealId: seal.id, padding: "x".repeat(600) }))).status, 400);
    assert.equal((await post({ sealId: seal.id }, { Cookie: "" })).status, 403);
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await post({ sealId: seal.id })).status, 403);
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + 600000) } });
    await db.user.update({ where: { id: user.id }, data: { role: "USER" } });
    assert.equal((await post({ sealId: seal.id })).status, 403);
    await db.user.update({ where: { id: user.id }, data: { role: "ADMIN", email: "not-allowlisted@example.test" } });
    assert.equal((await post({ sealId: seal.id })).status, 403);
    await db.user.update({ where: { id: user.id }, data: { email: user.email } });
    assert.equal(await db.novaRockRawCardCapture.count(), 0);
    assert.deepEqual(await snapshot(), before);
    const until = async (condition: () => Promise<boolean> | boolean, label: string) => {
      for (let n = 0; n < 300; n++) { if (await condition()) return; await new Promise((done) => setTimeout(done, 15)); }
      throw new Error("Timed out waiting for " + label + ": " + serverLog);
    };
    async function writerFirst(label: string, change: (tx: Prisma.TransactionClient) => Promise<unknown>) {
      writeFileSync(join(barrier, "arm"), label);
      const pending = post({ sealId: seal.id });
      let release!: () => void;
      let report!: (pid: number) => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const active = new Promise<number>((resolve) => { report = resolve; });
      let writer: Promise<void> | undefined;
      try {
        await until(() => existsSync(join(barrier, "started")), "mock transport barrier");
        writer = db.$transaction(async (tx) => {
          const rows = await tx.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid');
          await change(tx); report(rows[0].pid); await hold;
        }, { isolationLevel: "Serializable", timeout: 10000 });
        void writer.catch(() => {});
        const pid = await active;
        writeFileSync(join(barrier, "release"), "1");
        await until(async () => {
          const rows = await db.$queryRawUnsafe<{ blocked: boolean }[]>(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid <> $1::int AND $1::int = ANY(pg_blocking_pids(a.pid))) AS blocked', pid);
          return rows[0].blocked;
        }, label + " lock wait");
        release(); await writer;
        assert.equal((await pending).status, 409, label + " race refused");
        assert.equal(await db.novaRockRawCardCapture.count(), 0);
      } finally {
        release?.();
        if (writer) await Promise.allSettled([writer, pending]);
        rmSync(join(barrier, "arm"), { force: true }); rmSync(join(barrier, "started"), { force: true });
        rmSync(join(barrier, "release"), { force: true });
      }
    }
    if (process.env.NOVA_CAPTURE_COMPETE_ONLY === "1") {
      const attempts = await Promise.all([post({ sealId: seal.id }), post({ sealId: seal.id })]);
      assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await db.novaRockRawCardCapture.count(), 1);
      assert.deepEqual(await snapshot(), before, "competing inserts have zero publication side effects");
      return;
    }
    if (process.env.NOVA_CAPTURE_RACE_ONLY === "1") {
      await writerFirst("source", (tx) => tx.festivalSource.update({ where: { id: source.id }, data: { cadenceSeconds: 90000 } }));
      const changed = await db.festivalSource.findUniqueOrThrow({ where: { id: source.id } });
      assert.equal(changed.configurationGeneration, source.configurationGeneration + 1);
      assert.equal(changed.cadenceSeconds, 90000);
      const after = await snapshot();
      after.source = before.source;
      assert.deepEqual(after, before, "no candidate, catalogue, publication or queue mutation");
      assert.equal((await post({ sealId: seal.id })).status, 409, "fresh retry cannot adopt changed source generation");
      return;
    }
    await writerFirst("edition", (tx) => tx.festivalEdition.update({ where: { id: fixture.edition.id }, data: { startDate: new Date("2027-06-11") } }));
    await db.festivalEdition.update({ where: { id: fixture.edition.id }, data: { startDate: fixture.edition.startDate, updatedAt: fixture.edition.updatedAt } });
    await writerFirst("session", (tx) => tx.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + 600000) } });
    await writerFirst("reviewer", (tx) => tx.user.update({ where: { id: user.id }, data: { role: "USER" } }));
    await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await writerFirst("revoked", (tx) => tx.session.delete({ where: { id: session.id } }));
    await db.session.create({ data: { id: session.id, userId: user.id, tokenHash: session.tokenHash, expiresAt: new Date(Date.now() + 600000) } });
    assert.deepEqual(await snapshot(), before);
    const response = await post({ sealId: seal.id });
    assert.equal(response.status, 201, await response.clone().text().catch(() => ""));
    const resultBody = await response.json();
    assert.equal(resultBody.authority, "NONE");
    assert.equal(resultBody.cardCount, 44);
    assert.deepEqual(resultBody.blockers, ["NO_DEPLOYED_EXTRACTOR_ATTESTATION", "NO_ARTIST_ID_REVIEW_DECISION"]);
    const capture = await db.novaRockRawCardCapture.findUniqueOrThrow({ where: { sealId: seal.id } });
    const original = readFileSync(fixturePath);
    assert.deepEqual(Buffer.from(capture.rawBytes), original);
    assert.equal(capture.rawDocumentSha256, createHash("sha256").update(original).digest("hex"));
    assert.equal(capture.cards instanceof Array && capture.cards.length, 44);
    assert.equal(capture.sessionId, session.id);
    assert.equal(capture.reviewerId, user.id);
    // Deliberate SQL insert probes use only this disposable DB, never the
    // production HTTP boundary. CHECKs/triggers must reject forged lineage.
    const columns = ["id", "sealId", "candidateId", "attemptId", "sourceId", "festivalId", "editionId",
      "configurationGeneration", "leaseVersion", "reviewerId", "sessionId", "rawBytes",
      "rawDocumentSha256", "completedAt", "cards"];
    const copy = (overrides: Record<string, string> = {}) => db.$executeRawUnsafe(
      'INSERT INTO "NovaRockRawCardCapture" (' + columns.map((name) => '"' + name + '"').join(',') +
      ') SELECT ' + columns.map((name) => overrides[name] ?? (name === "id" ? 'gen_random_uuid()::text' : '"' + name + '"')).join(',') +
      ' FROM "NovaRockRawCardCapture" WHERE "id" = $1', capture.id);
    const sqlCode = (code: string) => (error: unknown) => {
      assert.equal((error as { meta?: { code?: string } }).meta?.code, code);
      return true;
    };
    await assert.rejects(copy({ rawDocumentSha256: "'0'::char(64)" }), sqlCode("23514"));
    await assert.rejects(copy({ rawBytes: "decode(repeat('00', 524289), 'hex')",
      rawDocumentSha256: "encode(sha256(decode(repeat('00', 524289), 'hex')), 'hex')" }), sqlCode("23514"));
    await assert.rejects(copy({ cards: "'[]'::jsonb" }));
    await assert.rejects(copy({ sourceId: "'wrong-source'" }));
    await assert.rejects(copy({ completedAt: "timestamp '2000-01-01'" }));
    await assert.rejects(copy(), sqlCode("23505"));
    assert.equal(await db.novaRockRawCardCapture.count(), 1);
    const duplicates = await Promise.all([post({ sealId: seal.id }), post({ sealId: seal.id })]);
    assert.deepEqual(duplicates.map((r) => r.status), [409, 409]);
    await assert.rejects(db.novaRockRawCardCapture.update({ where: { id: capture.id }, data: { sessionId: "replaced" } }));
    await assert.rejects(db.novaRockRawCardCapture.delete({ where: { id: capture.id } }));
    await assert.rejects(db.$executeRawUnsafe('TRUNCATE "NovaRockRawCardCapture"'));
    await assert.rejects(db.$executeRawUnsafe("UPDATE \"NovaRockRawCardCapture\" SET \"rawBytes\" = decode('00', 'hex')"));
    assert.deepEqual(await snapshot(), before);
    // Historical capture must not prevent logout/revocation.
    await db.session.delete({ where: { id: session.id } });
    assert.equal((await db.novaRockRawCardCapture.findUniqueOrThrow({ where: { id: capture.id } })).sessionId, session.id);
    assert.equal((await post({ sealId: seal.id })).status, 403);
  } finally {
    if (server) { server.kill("SIGTERM"); await new Promise((done) => { if (server!.exitCode !== null) done(null); else { server!.once("exit", done); setTimeout(done, 3000); } }); }
    rmSync(barrier, { recursive: true, force: true });
    await db.$disconnect();
  }
});
