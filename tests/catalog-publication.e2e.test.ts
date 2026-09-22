import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { backfillCatalog } from "../lib/catalog/backfill.ts";
import { publishIngestionResult } from "../lib/catalog/publication.ts";
import { catalogSeed } from "../lib/catalog/seed.ts";
import { createIngestionRun, persistAttempt } from "../lib/ingestion/repository.ts";
import type { IngestionResult } from "../lib/ingestion/types.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/(?:test|integration)/i.test(new URL(databaseUrl).pathname)) throw new Error("A test DATABASE_URL is required");
const db = new PrismaClient();
const execute = promisify(execFile);
const suffix = `${Date.now()}-${process.pid}`;
const createdArtists: string[] = [];

function result(artist: string, overrides: Partial<IngestionResult> = {}): IngestionResult {
  const fetchedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    festivalSlug: "rockharz",
    sourceUrl: "https://www.rockharz-festival.com/",
    fetchedAt,
    changes: [{ kind: "artist_added", field: "lineup", after: artist, reviewRequired: false }],
    candidate: {
      schemaVersion: 1,
      festivalSlug: "rockharz",
      sourceUrl: "https://www.rockharz-festival.com/",
      fetchedAt,
      startDate: "2027-07-07",
      lineup: [artist],
      evidence: [{ field: "lineup", sourceUrl: "https://www.rockharz-festival.com/", observedAt: fetchedAt, excerpt: artist }],
      warnings: [],
      observedEditionYears: [2027],
    },
    publishable: true,
    reviewReasons: [],
    ...overrides,
  };
}

async function persist(value: IngestionResult) {
  const run = await createIngestionRun(db, { trigger: "TEST", sourceCommit: suffix, totalSources: 1 });
  return persistAttempt(db, {
    runId: run.id,
    festivalSlug: value.festivalSlug,
    requestedUrl: value.sourceUrl,
    finalUrl: value.sourceUrl,
    httpStatus: 200,
    durationMs: 1,
    startedAt: new Date(value.fetchedAt),
    endedAt: new Date(value.fetchedAt),
    result: value,
  });
}

test.before(async () => { await backfillCatalog(db, catalogSeed); });
test.after(async () => {
  await db.catalogPlaylistRefresh.deleteMany({ where: { publication: { sourceId: { startsWith: `ingestion:` } }, festivalSlug: "rockharz" } });
  if (createdArtists.length) {
    await db.lineupEntry.deleteMany({ where: { artist: { slug: { in: createdArtists } } } });
    await db.artist.deleteMany({ where: { slug: { in: createdArtists } } });
  }
  await backfillCatalog(db, catalogSeed);
  await db.$disconnect();
});

test("commits catalog rows, candidate state, audit snapshot and playlist request together", async () => {
  const artist = `Catalog Transaction ${suffix}`;
  const value = result(artist);
  const attempt = await persist(value);
  const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
  assert.ok(publication);
  assert.equal(publication.playlistRefreshRequested, true);
  createdArtists.push(encodeURIComponent(artist.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")));

  const stored = await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  assert.equal(stored.reviewState, "PUBLISHED");
  assert.equal(stored.catalogueVersion, publication.id);
  const lineup = await db.lineupEntry.findFirst({ where: { edition: { festival: { slug: "rockharz" }, recordState: "CURRENT" }, artist: { name: artist } } });
  assert.ok(lineup);
  const queued = await db.catalogPlaylistRefresh.findUniqueOrThrow({ where: { publicationId: publication.id } });
  assert.equal(queued.status, "PENDING");

  const repeated = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });
  assert.equal(repeated?.id, publication.id);
  assert.equal(await db.catalogPublication.count({ where: { sourceId: publication.sourceId } }), 1);
  await assert.rejects(db.catalogPublication.update({ where: { id: publication.id }, data: { actorLabel: "tampered" } }), /append-only/);
  await assert.rejects(db.catalogPublication.delete({ where: { id: publication.id } }), /append-only/);
});

test("fails closed and rolls back every catalog row when artist identity is ambiguous", async () => {
  const requestedName = `Ambiguous Artist ${suffix}`;
  const slug = encodeURIComponent(requestedName.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
  await db.artist.create({ data: { slug, name: `${requestedName} Other`, aliases: [], genres: [], identityState: "UNRESOLVED", topTracks: [], recentSetlists: [], freshness: {} } });
  createdArtists.push(slug);
  const value = result(requestedName);
  const attempt = await persist(value);
  await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /Artist slug collision/);
  assert.equal(await db.catalogPublication.count({ where: { sourceId: { startsWith: "ingestion:" }, evidence: { path: ["candidateId"], equals: (await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).id } } }), 0);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).reviewState, "PENDING");
  assert.equal(await db.lineupEntry.count({ where: { edition: { festival: { slug: "rockharz" } }, artist: { name: requestedName } } }), 0);
});

test("reuses the canonical artist when the observed name differs only by case", async () => {
  const canonicalName = `Case Artist ${suffix}`;
  const observedName = `Case artist ${suffix}`;
  const slug = encodeURIComponent(canonicalName.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));
  const canonical = await db.artist.create({ data: { slug, name: canonicalName, aliases: [], genres: [], identityState: "UNRESOLVED", topTracks: [], recentSetlists: [], freshness: {} } });
  createdArtists.push(slug);
  const value = result(observedName);
  const attempt = await persist(value);

  const publication = await publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix });

  assert.ok(publication);
  assert.equal(await db.artist.count({ where: { slug } }), 1);
  const edition = await db.festivalEdition.findFirstOrThrow({
    where: { festival: { slug: "rockharz" }, recordState: "CURRENT" },
    select: { id: true },
  });
  const lineup = await db.lineupEntry.findUniqueOrThrow({ where: { editionId_artistId: { editionId: edition.id, artistId: canonical.id } } });
  assert.equal(lineup.artistId, canonical.id);
});

test("rejects an edition mismatch before changing the catalog", async () => {
  const artist = `Wrong Edition ${suffix}`;
  const value = result(artist);
  value.candidate.observedEditionYears = [2028];
  const attempt = await persist(value);
  await assert.rejects(publishIngestionResult(db, { attemptId: attempt.id, result: value, sourceCommit: suffix }), /does not match catalogue edition/);
  assert.equal((await db.ingestionCandidate.findUniqueOrThrow({ where: { attemptId: attempt.id } })).reviewState, "PENDING");
  assert.equal(await db.artist.count({ where: { name: artist } }), 0);
});

test("production Node exports playlist input from the committed database catalog", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "catalog-playlist-export-"));
  const output = path.join(directory, "catalog.json");
  try {
    const execution = await execute(process.execPath, ["scripts/export-playlist-catalog.mjs", output], { env: process.env });
    assert.match(execution.stdout, /Exported 51 festivals for 2027/);
    const exported = JSON.parse(await readFile(output, "utf8"));
    assert.equal(exported.season, 2027);
    assert.equal(exported.festivals.length, 51);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
