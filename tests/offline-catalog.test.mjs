import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { projectOfflineCatalog, readOfflineCatalog, serveOfflineCatalog } from "../lib/catalog/offline.ts";

const request = (tag) => new Request("http://localhost/api/offline/catalog", {
  headers: tag ? { "If-None-Match": tag } : {},
});
function edition(slug = "sample") {
  return {
    festival: { slug, name: "Sample Festival", internalNote: "private" },
    startDate: new Date("2027-06-04"), endDate: null,
    sourceUpdatedAt: new Date("2026-01-01"),
    timetable: [{ date: new Date("2027-06-04"), stage: "Main", start: "20:00",
      artistName: "Artist", timeZone: null, status: "ANNOUNCED",
      sourceUrl: "https://private.invalid", observedAt: new Date(), id: "internal" }],
  };
}

test("safe legacy projection, stable bytes and strong ETag; row order and metadata do not affect revision", async () => {
  const rows = [edition("z"), edition("a")];
  rows[0].timetable.push({ ...rows[0].timetable[0], artistName: "Other", status: "CANCELLED" });
  const read = () => Promise.resolve(projectOfflineCatalog(rows));
  const first = await serveOfflineCatalog(request(), read);
  const body = await first.text();
  const expectedHash = createHash("sha256").update(body).digest("hex");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("etag"), `"${expectedHash}"`);
  assert.equal(first.headers.get("x-catalog-revision"), expectedHash);
  assert.match(first.headers.get("cache-control"), /must-revalidate/);
  assert.equal(first.headers.get("set-cookie"), null);
  assert.match(first.headers.get("content-type"), /application\/json/);
  const payload = JSON.parse(body);
  assert.deepEqual(Object.keys(payload), ["schemaVersion", "dataVersion", "editionYear", "generatedAt", "timetableStatus", "festivals"]);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.editionYear, 2027);
  assert.equal(payload.generatedAt, null);
  assert.equal(payload.timetableStatus, "published");
  assert.deepEqual(Object.keys(payload.festivals[0]), ["slug", "name", "startDate", "endDate", "timetable"]);
  assert.deepEqual(payload.festivals[0].timetable[0], {
    date: "2027-06-04", stage: "Main", start: "20:00", artist: "Artist", timeZone: "UTC", status: "scheduled",
  });
  assert.equal(payload.festivals[0].endDate, null);
  assert.doesNotMatch(body, /private|sourceUpdatedAt|observedAt|internal/);
  rows.reverse();
  for (const row of rows) {
    row.sourceUpdatedAt = new Date("2030-01-01");
    row.timetable.reverse();
  }
  const unchanged = await serveOfflineCatalog(request(), read);
  assert.equal(await unchanged.text(), body);
  assert.equal(unchanged.headers.get("etag"), first.headers.get("etag"));
});

test("conditional GET supports weak/list/wildcard validators after a fresh read", async () => {
  let reads = 0;
  const read = async () => { reads++; return projectOfflineCatalog([edition()]); };
  const first = await serveOfflineCatalog(request(), read);
  const etag = first.headers.get("etag");
  for (const tag of [etag, `W/${etag}`, `"other", W/${etag}`, "*"]) {
    const response = await serveOfflineCatalog(request(tag), read);
    assert.equal(response.status, 304);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("etag"), etag);
    assert.equal(response.headers.get("cache-control"), first.headers.get("cache-control"));
    assert.equal(response.headers.get("x-catalog-revision"), first.headers.get("x-catalog-revision"));
  }
  assert.equal(reads, 5);
  for (const tag of ['"other"', etag.slice(1, -1), `W/${etag}trailing`]) {
    assert.equal((await serveOfflineCatalog(request(tag), read)).status, 200);
  }
});

test("public content changes invalidate old validators without timestamp updates", async () => {
  const row = edition();
  const read = async () => projectOfflineCatalog([row]);
  let etag = (await serveOfflineCatalog(request(), read)).headers.get("etag");
  for (const mutate of [
    () => { row.festival.name = "Changed"; },
    () => { row.startDate = new Date("2027-06-05"); },
    () => { row.timetable[0].start = "21:00"; },
    () => { row.timetable = []; },
  ]) {
    mutate();
    const response = await serveOfflineCatalog(request(etag), read);
    assert.equal(response.status, 200);
    assert.notEqual(response.headers.get("etag"), etag);
    etag = response.headers.get("etag");
  }
  assert.equal(projectOfflineCatalog([row]).timetableStatus, "not-published");
});

test("DB query selects only current 2027 public fields; missing/failed DB fails closed even with wildcard", async () => {
  let query;
  const database = { festivalEdition: { findMany: async (args) => { query = args; return [edition()]; } } };
  await readOfflineCatalog(database);
  assert.deepEqual(query.where, { year: 2027, recordState: "CURRENT" });
  assert.deepEqual(Object.keys(query.select), ["festival", "startDate", "endDate", "timetable"]);
  for (const findMany of [async () => [], async () => { throw new Error("secret connection error"); }]) {
    const response = await serveOfflineCatalog(request("*"), () => readOfflineCatalog({ festivalEdition: { findMany } }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("x-catalog-revision"), null);
    assert.equal(await response.text(), "");
  }
});

test("actual GET route reads DB on each call and never returns 304 during DB failure", async () => {
  // Supply the existing db.ts development singleton before its lazy import.
  // No real connection string or database is needed for route wiring checks.
  let rows = [edition()];
  let fail = false;
  let reads = 0;
  const previous = globalThis.prisma;
  globalThis.prisma = { festivalEdition: { findMany: async () => {
    reads++;
    if (fail) throw new Error("DB unavailable");
    return rows;
  } } };
  try {
    const { GET, dynamic, runtime } = await import("../app/api/offline/catalog/route.ts");
    assert.equal(dynamic, "force-dynamic");
    assert.equal(runtime, "nodejs");
    const first = await GET(request());
    assert.equal(first.status, 200);
    assert.equal((await GET(request(first.headers.get("etag")))).status, 304);
    rows[0].festival.name = "Fresh DB name";
    assert.equal((await GET(request(first.headers.get("etag")))).status, 200);
    rows = [];
    assert.equal((await GET(request("*"))).status, 503);
    fail = true;
    const failure = await GET(request(first.headers.get("etag")));
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get("cache-control"), "no-store");
    assert.equal(reads, 5);
  } finally {
    if (previous === undefined) delete globalThis.prisma;
    else globalThis.prisma = previous;
  }
});
