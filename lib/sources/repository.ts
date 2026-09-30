import { Prisma, PrismaClient, type FestivalSource as SourceRow } from "@prisma/client";
import { hasOfficialMarkupAdapter } from "../ingestion/adapters/official-markup.ts";
import type { FestivalSource, ParserStrategy, RefreshPolicy } from "../ingestion/types.ts";

type Database = PrismaClient | Prisma.TransactionClient;
const strategies: ParserStrategy[] = ["json_ld_event", "html_fallback", "official_markup", "manual_review"];
const cadence: Record<RefreshPolicy, number> = { daily: 86400, every_3_days: 259200, weekly: 604800, archived: 2592000 };
const policies = Object.keys(cadence);
class SourceSeedValidationError extends Error {}

function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password && !/[\u0000-\u001f\u007f]/.test(value);
  } catch { return false; }
}

export function sourceParserKey(source: Pick<FestivalSource, "festivalSlug" | "strategies">): string {
  if (!Array.isArray(source.strategies) || !source.strategies.length || source.strategies.some((value) => !strategies.includes(value)) || new Set(source.strategies).size !== source.strategies.length) throw new SourceSeedValidationError("Invalid parser strategies");
  if (source.strategies.includes("manual_review") && source.strategies.length !== 1) throw new SourceSeedValidationError("Manual parser cannot be combined");
  if (source.strategies.includes("official_markup") && !hasOfficialMarkupAdapter(source.festivalSlug)) throw new SourceSeedValidationError("Unknown official parser for " + source.festivalSlug);
  return source.strategies.join("+") + (source.strategies.includes("official_markup") ? ":" + source.festivalSlug : "");
}

export function validateSource(source: FestivalSource & { parserKey?: string }): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source.festivalSlug)) throw new SourceSeedValidationError("Invalid festival slug");
  if (!validUrl(source.url) || (source.fetchUrl !== undefined && !validUrl(source.fetchUrl))) throw new SourceSeedValidationError("Invalid source or fetch URL");
  if (!Number.isInteger(source.editionYear) || source.editionYear < 2000 || source.editionYear > 2100) throw new SourceSeedValidationError("Invalid source edition");
  if (!policies.includes(source.refreshPolicy)) throw new SourceSeedValidationError("Invalid refresh policy");
  if (typeof source.enabled !== "boolean") throw new SourceSeedValidationError("Invalid source enabled flag");
  if (source.followLinkPattern !== undefined) {
    const pattern = source.followLinkPattern;
    if (!pattern || pattern.length > 256 || !pattern.startsWith("^") || !pattern.endsWith("$") || /[()|]/.test(pattern) || /\\[1-9]/.test(pattern)) throw new SourceSeedValidationError("Unsafe follow-link regex");
    try { new RegExp(pattern, "i"); } catch { throw new SourceSeedValidationError("Invalid follow-link regex"); }
  }
  if (source.headers !== undefined && (!source.headers || typeof source.headers !== "object" || Array.isArray(source.headers) || Object.entries(source.headers).some(([key, value]) => !/^[a-z0-9-]+$/i.test(key) || typeof value !== "string" || /[\r\n]/.test(value)))) throw new SourceSeedValidationError("Invalid request headers");
  const key = sourceParserKey(source);
  if (source.parserKey !== undefined && source.parserKey !== key) throw new SourceSeedValidationError("Unknown or mismatched parser key: " + source.parserKey);
  return key;
}

export type ConfiguredSource = FestivalSource & { id: string; editionId: string | null; parserKey: string; cadenceSeconds: number; nextRunAt: Date | null; consecutiveFailures: number; leaseOwner: string | null; leaseExpiresAt: Date | null; httpEtag: string | null; httpLastModified: string | null };

// Strict mapper for the future DB reader. Legacy rows are intentionally not read by current runtime.
export function mapSource(row: SourceRow & { edition?: { festivalId: string; year: number } | null }): ConfiguredSource {
  const headers = row.requestHeaders;
  if (headers !== null && (typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string"))) throw new Error("Invalid stored request headers");
  const source: FestivalSource = { festivalSlug: row.festivalSlug, url: row.url, strategies: row.strategies as ParserStrategy[], refreshPolicy: row.refreshPolicy as RefreshPolicy, enabled: row.enabled, editionYear: row.editionYear, ...(row.fetchUrl ? { fetchUrl: row.fetchUrl } : {}), ...(row.followLinkPattern ? { followLinkPattern: row.followLinkPattern } : {}), ...(headers ? { headers: headers as Record<string, string> } : {}), ...(row.manualReviewReason ? { manualReviewReason: row.manualReviewReason } : {}) };
  if (!row.parserKey || validateSource({ ...source, parserKey: row.parserKey }) !== row.parserKey) throw new Error("Unconfigured parser");
  if ((row.enabled && (!row.festivalId || !row.editionId)) || (row.editionId && (!row.edition || row.edition.year !== row.editionYear || row.edition.festivalId !== row.festivalId))) throw new Error("Invalid source edition binding");
  if (!row.cadenceSeconds || row.cadenceSeconds <= 0 || !Number.isInteger(row.cadenceSeconds)) throw new Error("Invalid source cadence");
  return { ...source, id: row.id, editionId: row.editionId, parserKey: row.parserKey, cadenceSeconds: row.cadenceSeconds, nextRunAt: row.nextRunAt, consecutiveFailures: row.consecutiveFailures, leaseOwner: row.leaseOwner, leaseExpiresAt: row.leaseExpiresAt, httpEtag: row.httpEtag, httpLastModified: row.httpLastModified };
}

export async function listConfiguredSources(db: Database, festivalSlug?: string): Promise<ConfiguredSource[]> {
  return (await db.festivalSource.findMany({ ...(festivalSlug ? { where: { festivalSlug } } : {}), include: { edition: { select: { festivalId: true, year: true } } }, orderBy: [{ festivalSlug: "asc" }, { url: "asc" }] })).map(mapSource);
}

type Plan = { festivalSlug: string; url: string; action: "insert" | "fill" | "preserve"; fields: string[]; drift: string[] };
export type SourceBackfillReport = { ok: boolean; counts: Record<Plan["action"], number>; plan: Plan[] };

// Only these local planning rejects may be exposed as diagnostic categories.
// Messages remain useful locally but must never reach the protected audit.
export type SourceBackfillRejectCode = "seed-validation" | "duplicate-source" | "missing-enabled-festival" | "missing-edition" | "binding-conflict" | "legacy-config-conflict" | "unresolved-drift";
// Numeric, inventory-indexed CURRENT values only. The fifth strategy bit means
// at least one unrecognized DB strategy (never serialize its string value).
export type ConflictTuple = readonly [index: number, editionYear: number, refreshPolicy: number, strategies: number];
export type LegacyConfigConflictSummary = Readonly<{ affectedRows: number; editionYear: number; refreshPolicy: number; strategies: number; digest: readonly ConflictTuple[] }>;
export const MAX_CONFLICT_DIGEST = 20;
const policyCodes: Record<string, number> = { daily: 1, every_3_days: 2, weekly: 3, archived: 4 };
export function policyCode(value: string): number { return Object.hasOwn(policyCodes, value) ? policyCodes[value] : 0; }
export function strategyMask(values: readonly string[]): number {
  return values.reduce((mask, value) => {
    const index = strategies.indexOf(value as ParserStrategy);
    return mask | (index === -1 ? 16 : 1 << index);
  }, 0);
}
export class SourceBackfillReject extends Error {
  readonly code: SourceBackfillRejectCode;
  readonly conflictSummary?: LegacyConfigConflictSummary;
  constructor(code: "legacy-config-conflict", message: string, conflictSummary: LegacyConfigConflictSummary);
  constructor(code: Exclude<SourceBackfillRejectCode, "legacy-config-conflict">, message: string);
  constructor(code: SourceBackfillRejectCode, message: string, conflictSummary?: LegacyConfigConflictSummary) {
    super(message); this.name = "SourceBackfillReject"; this.code = code;
    if (code === "legacy-config-conflict" && conflictSummary) this.conflictSummary = conflictSummary;
  }
}

// Called only by the explicit one-time operator command. Never by catalogue backfill or deploy.
export async function backfillSources(db: PrismaClient, inventory: readonly FestivalSource[], options: { dryRun?: boolean; failOnDrift?: boolean } = {}): Promise<SourceBackfillReport> {
  return db.$transaction(async (tx) => {
    const festivals = await tx.festival.findMany({ select: { id: true, slug: true, editions: { select: { id: true, year: true } } } });
    const existing = await tx.festivalSource.findMany();
    const festivalBySlug = new Map(festivals.map((festival) => [festival.slug, festival]));
    const rowByKey = new Map(existing.map((row) => [JSON.stringify([row.festivalSlug, row.url]), row]));
    const seen = new Set<string>();
    const operations: { where: { festivalSlug_url: { festivalSlug: string; url: string } }; create: Prisma.FestivalSourceCreateInput; patch: Prisma.FestivalSourceUpdateInput; action: Plan["action"] }[] = [];
    const plan: Plan[] = [];
    const conflictSummary: { affectedRows: number; editionYear: number; refreshPolicy: number; strategies: number; digest: ConflictTuple[] } = { affectedRows: 0, editionYear: 0, refreshPolicy: 0, strategies: 0, digest: [] };
    for (const [index, source] of inventory.entries()) {
      let parserKey: string;
      try { parserKey = validateSource(source); }
      catch (error) {
        // Categorize by origin, never by parsing an exception's message.
        if (error instanceof SourceSeedValidationError) throw new SourceBackfillReject("seed-validation", error.message);
        throw error;
      }
      const key = JSON.stringify([source.festivalSlug, source.url]);
      if (seen.has(key)) throw new SourceBackfillReject("duplicate-source", "Duplicate source: " + key);
      seen.add(key);
      const festival = festivalBySlug.get(source.festivalSlug);
      if (!festival && source.enabled) throw new SourceBackfillReject("missing-enabled-festival", "Missing enabled festival: " + source.festivalSlug);
      const edition = festival?.editions.find((item) => item.year === source.editionYear);
      if (!edition && source.enabled) throw new SourceBackfillReject("missing-edition", "Missing source edition: " + key + " / " + source.editionYear);
      const row = rowByKey.get(key);
      if (row?.festivalId && row.festivalId !== festival?.id) throw new SourceBackfillReject("binding-conflict", "Source festival binding conflict: " + key);
      if (row?.editionId && row.editionId !== edition?.id) throw new SourceBackfillReject("binding-conflict", "Source edition binding conflict: " + key);
      if (row && !row.configurationBackfilledAt) {
        const year = row.editionYear !== source.editionYear;
        const policy = row.refreshPolicy !== source.refreshPolicy;
        const strategy = JSON.stringify(row.strategies) !== JSON.stringify(source.strategies);
        if (year || policy || strategy) {
          // Never leak a prefix if the bounded diagnostic cannot represent the scan.
          if (conflictSummary.digest.length === MAX_CONFLICT_DIGEST) throw new Error("Conflict digest bound exceeded");
          conflictSummary.digest.push([index, row.editionYear, policyCode(row.refreshPolicy), strategyMask(row.strategies)]);
          conflictSummary.affectedRows++;
          if (year) conflictSummary.editionYear++;
          if (policy) conflictSummary.refreshPolicy++;
          if (strategy) conflictSummary.strategies++;
          // Still validate every inventory entry. Another planning rejection
          // takes precedence over an incomplete conflict scan.
          continue;
        }
      }
      const desired = { festivalId: festival?.id ?? null, editionId: edition?.id ?? null, parserKey, fetchUrl: source.fetchUrl ?? null, followLinkPattern: source.followLinkPattern ?? null, requestHeaders: source.headers ?? null, cadenceSeconds: cadence[source.refreshPolicy] };
      const fields: string[] = [];
      const drift: string[] = row && row.enabled !== source.enabled ? ["enabled"] : [];
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(desired)) {
        const current = row?.[field as keyof SourceRow];
        if (!row || (!row.configurationBackfilledAt && current === null && value !== null)) { fields.push(field); if (row) patch[field] = value; }
        else if (row && current !== null && JSON.stringify(current) !== JSON.stringify(value)) drift.push(field);
      }
      const action = !row ? "insert" : !row.configurationBackfilledAt ? "fill" : "preserve";
      plan.push({ festivalSlug: source.festivalSlug, url: source.url, action, fields, drift });
      operations.push({ where: { festivalSlug_url: { festivalSlug: source.festivalSlug, url: source.url } }, create: { ...(festival ? { festival: { connect: { id: festival.id } } } : {}), ...(edition ? { edition: { connect: { id: edition.id } } } : {}), festivalSlug: source.festivalSlug, url: source.url, strategies: source.strategies, refreshPolicy: source.refreshPolicy, enabled: source.enabled, editionYear: source.editionYear, manualReviewReason: source.manualReviewReason, parserKey, fetchUrl: source.fetchUrl, followLinkPattern: source.followLinkPattern, requestHeaders: source.headers, cadenceSeconds: cadence[source.refreshPolicy], configurationBackfilledAt: new Date() }, patch: { ...patch, configurationBackfilledAt: new Date() }, action });
    }
    if (conflictSummary.affectedRows) throw new SourceBackfillReject("legacy-config-conflict", "Legacy source configuration conflict", conflictSummary);
    // A first migration with drift is not an acknowledged migration. Reject the
    // entire plan before inserts, fills, or configurationBackfilledAt updates.
    // Marked rows are already DB-owned: their operator edits remain reportable
    // drift, but must not prevent unrelated first-time configuration in the
    // legacy/local mode. The protected production operation opts into a strict
    // all-drift gate and never acknowledges any conflicting configuration.
    const initialDrift = plan.filter((entry) => entry.action === "fill" && entry.drift.length);
    const driftToReject = options.failOnDrift ? plan.filter((entry) => entry.drift.length) : initialDrift;
    if (!options.dryRun && driftToReject.length) {
      throw new SourceBackfillReject("unresolved-drift", (options.failOnDrift ? "Unresolved source drift: " : "Unresolved initial source drift: ") + driftToReject.map((entry) =>
        JSON.stringify([entry.festivalSlug, entry.url]) + " (" + entry.drift.join(", ") + ")"
      ).join("; "));
    }
    if (!options.dryRun) for (const operation of operations) {
      if (operation.action === "insert") await tx.festivalSource.create({ data: operation.create });
      else if (operation.action === "fill") await tx.festivalSource.update({ where: operation.where, data: operation.patch });
    }
    return { ok: plan.every((entry) => !entry.drift.length), counts: { insert: plan.filter((entry) => entry.action === "insert").length, fill: plan.filter((entry) => entry.action === "fill").length, preserve: plan.filter((entry) => entry.action === "preserve").length }, plan };
  }, { timeout: 30000 });
}
