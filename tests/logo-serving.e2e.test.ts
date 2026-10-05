import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { auditReviewedLogos, applyReviewedLogos, verifyReviewedLogos } from "../lib/catalog/logo-import.ts";
import { databaseLogoPath } from "../data/logo-serving.ts";
import { requireLocalDisposableLogoDatabase } from "./logo-import-db-guard.ts";

requireLocalDisposableLogoDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const rows = await auditReviewedLogos();
const origin = "http://127.0.0.1:3267";
let app: ReturnType<typeof spawn> | undefined;
let spawnFailed = false;

function request(url: string, options: RequestInit = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
}

test.before(async () => {
  // Requires the migrated, backfilled disposable catalogue. Never target production.
  await applyReviewedLogos(db, rows);
  await verifyReviewedLogos(db, rows);
  assert.equal(await db.festivalLogo.count(), 47);
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3267"], {
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "" }, stdio: "ignore",
  });
  app.on("error", () => { spawnFailed = true; });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnFailed || app.exitCode !== null) throw new Error("Logo test server exited");
    try {
      const response = await fetch(`${origin}/api/logos/invalid.png/`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 404) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Logo test server readiness timed out");
}, { timeout: 60_000 });

test.after(async () => {
  try {
    if (app?.pid && app.exitCode === null) {
      const stopped = once(app, "exit");
      app.kill("SIGTERM");
      const killTimer = setTimeout(() => app?.kill("SIGKILL"), 5000);
      try { await stopped; } finally { clearTimeout(killTimer); }
    }
  } finally { await db.$disconnect(); }
});

test("47 imported logos serve through actual Next HTTP routing with exact bytes/MIME and conditional cache", { timeout: 90_000 }, async () => {
  for (const row of rows) {
    const url = origin + databaseLogoPath(`/logos/${row.file}`) + "/";
    const response = await request(url);
    assert.equal(response.status, 200, row.file);
    assert.equal(response.headers.get("content-type"), row.mimeType);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), row.bytes);
    assert.equal(response.headers.get("etag"), `"${row.sha256}"`);
    const conditional = await request(url, { headers: { "If-None-Match": `"other", W/"${row.sha256}"` } });
    assert.equal(conditional.status, 304);
    assert.equal(await conditional.text(), "");
    assert.equal(conditional.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  }
  for (const path of ["unknown.png", "bloodstock.png", rows[0].sha256, "2000trees.jpg", "%2e%2e%2f2000trees.png", "2000trees.png/extra"]) {
    assert.equal((await request(`${origin}/api/logos/${path}/`)).status, 404, path);
  }
  const first = rows[0];
  const url = `${origin}/api/logos/${first.file}/`;
  assert.equal((await request(url, { headers: { "If-None-Match": '"different"' } })).status, 200);
  const head = await request(url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("content-length"), String(first.sizeBytes));
  // Missing binding must not be mistaken for a wildcard conditional hit.
  const binding = await db.festivalLogo.findFirstOrThrow({ where: { festival: { slug: first.slug } } });
  await db.festivalLogo.delete({ where: { festivalId: binding.festivalId } });
  try {
    const missing = await request(url, { headers: { "If-None-Match": "*" } });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    const fallback = await request(`${origin}/logos/${first.file}`);
    assert.equal(fallback.status, 200);
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), first.bytes);
  } finally { await db.festivalLogo.create({ data: binding }); }
});
