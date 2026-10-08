import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readAcquisitionProvenance } from "./provenance.ts";
import { INGESTION_POLICY_VERSION } from "./repository.ts";

const url = "https://www.novarock.at/lineup/";
const id = z.string().min(1);
const time = z.string().datetime();
const field = z.enum(["startDate", "endDate", "headliners", "lineup"]);
const value = z.union([z.string(), z.array(z.string()), z.null()]);
const normalizedSchema = z.object({
  schemaVersion: z.literal(1), festivalSlug: z.literal("nova-rock"), sourceUrl: z.literal(url), fetchedAt: time,
  startDate: z.literal("2027-06-09"), endDate: z.literal("2027-06-12"),
  headliners: z.array(z.string().min(1).max(100)).length(4), lineup: z.array(z.string().min(1).max(100)).length(40),
  observedEditionYears: z.tuple([z.literal(2027)]), warnings: z.array(z.string()),
  evidence: z.array(z.object({ field, sourceUrl: z.literal(url), observedAt: time, excerpt: z.string().max(2000).optional() }).strict()).length(4),
}).strict();
const candidateSchema = z.object({
  id, runId: id, attemptId: id, festivalSlug: z.literal("nova-rock"), schemaVersion: z.literal(1),
  sourceEdition: z.literal("2027-06-09"), sourceYear: z.literal(2027), normalized: normalizedSchema,
  warnings: z.array(z.string()), publishable: z.literal(false), supersedesId: id.nullable(), createdAt: time,
}).strict();
const attemptSchema = z.object({
  id, runId: id, festivalSlug: z.literal("nova-rock"), requestedUrl: z.literal(url), finalUrl: z.literal(url),
  httpStatus: z.literal(200), durationMs: z.number().int().nonnegative(), retryCount: z.number().int().nonnegative(), error: z.null(),
  acquisitionProvenance: z.unknown(), parserVersions: z.object({ extractor: z.literal(1) }).strict(),
  status: z.literal("REVIEW"), startedAt: time, endedAt: time, priorAttemptId: id.nullable(),
}).strict();
const runSchema = z.object({
  id, schemaVersion: z.literal(1), trigger: z.enum(["SCHEDULE", "MANUAL", "API", "TEST"]), sourceCommit: z.string().min(1),
  startedAt: time, endedAt: time, status: z.enum(["COMPLETED", "PARTIAL"]), totalSources: z.number().int().nonnegative(),
  successful: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), reviewRequired: z.number().int().nonnegative(),
  publishable: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), createdAt: time,
}).strict();
const evidenceSchema = z.object({ id, candidateId: id, field, observedValue: value, sourceUrl: z.literal(url),
  excerpt: z.string().max(2000).nullable(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), observedAt: time,
  adapter: z.literal("festival-extractor-v1"),
}).strict();
const diffSchema = z.object({ id, candidateId: id, field, beforeValue: value, afterValue: value,
  reviewRequired: z.boolean(), policyVersion: z.literal(INGESTION_POLICY_VERSION), createdAt: time,
}).strict();
const snapshotSchema = z.object({ version: z.literal(1), candidate: candidateSchema, attempt: attemptSchema,
  run: runSchema, evidence: z.array(evidenceSchema).length(4), diffs: z.array(diffSchema).min(1).max(200),
}).strict();

/** Canonical JSON v1: UTF-16 key order, ordered arrays, finite safe JSON numbers.
 * Never silently drops undefined, non-JSON objects or sparse array slots. */
export function canonicalNovaContent(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1 ||
        !Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean)) throw new Error("Unsupported JSON array");
    return `[${value.map(canonicalNovaContent).join(",")}]`;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) throw new Error("Unsupported JSON object");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalNovaContent((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Unsupported JSON payload");
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: unknown, b: unknown) => canonicalNovaContent(a) === canonicalNovaContent(b);

/** Independently validate and digest every persisted row, never an export fingerprint.
 * Not approval: contains no reviewer, identity bindings or catalogue baseline. */
export function digestNovaRockContent(input: unknown) {
  canonicalNovaContent(input); // Validate before Zod can strip/transform anything.
  const snapshot = snapshotSchema.parse(input);
  const { candidate: c, attempt: a, run: r, evidence, diffs } = snapshot;
  if (c.attemptId !== a.id || c.runId !== r.id || a.runId !== r.id) throw new Error("Replaced ingestion lineage");
  const provenance = readAcquisitionProvenance(a.acquisitionProvenance);
  if (!provenance) throw new Error("Missing or unsupported acquisition provenance");
  const config = provenance.configuration;
  if (config.festivalSlug !== "nova-rock" || config.editionYear !== 2027 || config.editionRecordState !== "CURRENT" ||
      config.url !== url || config.parserKey !== "official_markup:nova-rock" || !equal(config.strategies, ["official_markup"]) ||
      config.fetchUrl !== null || config.followLinkPattern !== null) throw new Error("Unsupported source configuration");
  const n = c.normalized;
  if (!equal(n.warnings, c.warnings)) throw new Error("Warnings disagree");
  const names = [...n.headliners, ...n.lineup].map((name) => name.normalize("NFC").toLowerCase());
  if (new Set(names).size !== 44) throw new Error("Duplicate observed artist names");
  const ids = [...evidence, ...diffs].map((row) => row.id);
  if (new Set(ids).size !== ids.length || new Set(evidence.map((e) => e.field)).size !== 4 ||
      new Set(n.evidence.map((e) => e.field)).size !== 4) throw new Error("Duplicate evidence/diff rows");
  for (const e of evidence) {
    const original = n.evidence.find((item) => item.field === e.field);
    if (e.candidateId !== c.id || !original || !equal(e.observedValue, n[e.field]) ||
        e.observedAt !== new Date(original.observedAt).toISOString() || e.sourceUrl !== original.sourceUrl ||
        e.excerpt !== (original.excerpt ?? null) ||
        e.contentHash !== hash(original.excerpt ?? JSON.stringify(n[e.field]))) throw new Error("Evidence disagrees with normalized candidate");
  }
  for (const d of diffs) if (d.candidateId !== c.id) throw new Error("Replaced diff lineage");
  // Row retrieval order is irrelevant; all IDs and content remain bound. Billing order stays intact.
  snapshot.evidence.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  snapshot.diffs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { snapshot, contentDigest: hash(canonicalNovaContent(snapshot)) };
}

type Tx = Prisma.TransactionClient;
async function load(tx: Tx, candidateId: string) {
  const row = await tx.ingestionCandidate.findUniqueOrThrow({ where: { id: candidateId }, include: { attempt: true, run: true, evidence: true, diffs: true } });
  // Lifecycle metadata is neither immutable content nor approval authority.
  const { attempt, run, evidence, diffs, reviewState, reviewActor: _reviewActor,
    reviewedAt: _reviewedAt, publishedAt: _publishedAt, catalogueVersion: _catalogueVersion, ...candidate } = row;
  // Prisma DateTime -> JSON ISO; JSON payloads have already been persisted by Prisma.
  const snapshot = JSON.parse(JSON.stringify({ version: 1, candidate, attempt, run, evidence, diffs }));
  const newest = await tx.ingestionAttempt.findMany({ where: { festivalSlug: "nova-rock" }, orderBy: { endedAt: "desc" }, take: 2, select: { id: true, endedAt: true } });
  if (newest[0]?.id !== attempt.id || (newest[1] && newest[1].endedAt >= attempt.endedAt)) throw new Error("Historical or ambiguous ingestion attempt");
  return { ...digestNovaRockContent(snapshot), reviewState };
}
async function lock(tx: Tx, candidateId: string) {
  const c = await tx.ingestionCandidate.findUniqueOrThrow({ where: { id: candidateId }, select: { runId: true, attemptId: true } });
  await tx.$queryRaw`SELECT id FROM "IngestionRun" WHERE id = ${c.runId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "IngestionAttempt" WHERE id = ${c.attemptId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "IngestionCandidate" WHERE id = ${candidateId} FOR UPDATE`;
}

/** Creates an integrity seal only. No caller-supplied snapshot or reviewer text accepted. */
export async function sealNovaRockContent(db: PrismaClient, candidateId: string) {
  return db.$transaction(async (tx) => {
    await lock(tx, candidateId);
    const content = await load(tx, candidateId);
    const existing = await tx.novaRockContentSeal.findUnique({ where: { candidateId } });
    if (existing) {
      if (existing.version !== 1 || existing.contentDigest !== content.contentDigest || !equal(existing.snapshot, content.snapshot)) throw new Error("Content seal mismatch");
      return existing;
    }
    if (content.reviewState !== "PENDING") throw new Error("Content seal creation requires PENDING candidate");
    return tx.novaRockContentSeal.create({ data: { candidateId, version: 1, contentDigest: content.contentDigest, snapshot: content.snapshot as unknown as Prisma.InputJsonValue } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
}

/** Fresh read with transaction revalidation. Success conveys integrity only, never approval. */
export async function verifyNovaRockContentSeal(db: PrismaClient, sealId: string) {
  return db.$transaction(async (tx) => {
    const seal = await tx.novaRockContentSeal.findUniqueOrThrow({ where: { id: sealId } });
    await lock(tx, seal.candidateId);
    const content = await load(tx, seal.candidateId);
    if (seal.version !== 1 || seal.contentDigest !== content.contentDigest || !equal(seal.snapshot, content.snapshot)) throw new Error("Content seal mismatch");
    return { sealId: seal.id, candidateId: seal.candidateId, contentDigest: content.contentDigest, authority: "NONE" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
}
