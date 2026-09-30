import { Prisma, PrismaClient, type FestivalSource as SourceRow } from "@prisma/client";
import { hasOfficialMarkupAdapter } from "../ingestion/adapters/official-markup.ts";
import type { FestivalSource, ParserStrategy, RefreshPolicy } from "../ingestion/types.ts";

type Database = PrismaClient | Prisma.TransactionClient;
const strategies: ParserStrategy[] = ["json_ld_event", "html_fallback", "official_markup", "manual_review"];
const cadence: Record<RefreshPolicy, number> = { daily: 86400, every_3_days: 259200, weekly: 604800, archived: 2592000 };
const policies = Object.keys(cadence);

function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password && !/[\u0000-\u001f\u007f]/.test(value);
  } catch { return false; }
}

export function sourceParserKey(source: Pick<FestivalSource, "festivalSlug" | "strategies">): string {
  if (!Array.isArray(source.strategies) || !source.strategies.length || source.strategies.some((value) => !strategies.includes(value)) || new Set(source.strategies).size !== source.strategies.length) throw new Error("Invalid parser strategies");
  if (source.strategies.includes("manual_review") && source.strategies.length !== 1) throw new Error("Manual parser cannot be combined");
  if (source.strategies.includes("official_markup") && !hasOfficialMarkupAdapter(source.festivalSlug)) throw new Error("Unknown official parser for " + source.festivalSlug);
  return source.strategies.join("+") + (source.strategies.includes("official_markup") ? ":" + source.festivalSlug : "");
}

export function validateSource(source: FestivalSource & { parserKey?: string }): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source.festivalSlug)) throw new Error("Invalid festival slug");
  if (!validUrl(source.url) || (source.fetchUrl !== undefined && !validUrl(source.fetchUrl))) throw new Error("Invalid source or fetch URL");
  if (!Number.isInteger(source.editionYear) || source.editionYear < 2000 || source.editionYear > 2100) throw new Error("Invalid source edition");
  if (!policies.includes(source.refreshPolicy)) throw new Error("Invalid refresh policy");
  if (typeof source.enabled !== "boolean") throw new Error("Invalid source enabled flag");
  if (source.followLinkPattern !== undefined) {
    const pattern = source.followLinkPattern;
    if (!pattern || pattern.length > 256 || !pattern.startsWith("^") || !pattern.endsWith("$") || /[()|]/.test(pattern) || /\\[1-9]/.test(pattern)) throw new Error("Unsafe follow-link regex");
    try { new RegExp(pattern, "i"); } catch { throw new Error("Invalid follow-link regex"); }
  }
  if (source.headers !== undefined && (!source.headers || typeof source.headers !== "object" || Array.isArray(source.headers) || Object.entries(source.headers).some(([key, value]) => !/^[a-z0-9-]+$/i.test(key) || typeof value !== "string" || /[\r\n]/.test(value)))) throw new Error("Invalid request headers");
  const key = sourceParserKey(source);
  if (source.parserKey !== undefined && source.parserKey !== key) throw new Error("Unknown or mismatched parser key: " + source.parserKey);
  return key;
}

export type ConfiguredSource = FestivalSource & { id: string; editionId: string | null; parserKey: string; cadenceSeconds: number; nextRunAt: Date | null; consecutiveFailures: number; leaseOwner: string | null; leaseExpiresAt: Date | null; httpEtag: string | null; httpLastModified: string | null };

// Strict mapper for the future DB reader. Legacy rows are intentionally not read by current runtime.
export function mapSource(row: SourceRow & { edition?: { festivalId: string; year: number } | null }): ConfiguredSource {
  const headers = row.requestHeaders;
  if (headers !== null && (typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string"))) throw new Error("Invalid stored request headers");
  const source: FestivalSource = { festivalSlug: row.festivalSlug, url: row.url, strategies: row.strategies as ParserStrategy[], refreshPolicy: row.refreshPolicy as RefreshPolicy, enabled: row.enabled, editionYear: row.editionYear, ...(row.fetchUrl ? { fetchUrl: row.fetchUrl } : {}), ...(row.followLinkPattern ? { followLinkPattern: row.followLinkPattern } : {}), ...(headers ? { headers: headers as Record<string, string> } : {}), ...(row.manualReviewReason ? { manualReviewReason: row.manualReviewReason } : {}) };
  if (!row.parserKey || validateSource({ ...source, parserKey: row.parserKey }) !== row.parserKey) throw new Error("Unconfigured parser");
  if (!row.festivalId || (row.enabled && !row.editionId) || (row.editionId && (!row.edition || row.edition.year !== row.editionYear || row.edition.festivalId !== row.festivalId))) throw new Error("Invalid source edition binding");
  if (!row.cadenceSeconds || row.cadenceSeconds <= 0 || !Number.isInteger(row.cadenceSeconds)) throw new Error("Invalid source cadence");
  return { ...source, id: row.id, editionId: row.editionId, parserKey: row.parserKey, cadenceSeconds: row.cadenceSeconds, nextRunAt: row.nextRunAt, consecutiveFailures: row.consecutiveFailures, leaseOwner: row.leaseOwner, leaseExpiresAt: row.leaseExpiresAt, httpEtag: row.httpEtag, httpLastModified: row.httpLastModified };
}

export async function listConfiguredSources(db: Database, festivalSlug?: string): Promise<ConfiguredSource[]> {
  return (await db.festivalSource.findMany({ ...(festivalSlug ? { where: { festivalSlug } } : {}), include: { edition: { select: { festivalId: true, year: true } } }, orderBy: [{ festivalSlug: "asc" }, { url: "asc" }] })).map(mapSource);
}

type Plan = { festivalSlug: string; url: string; action: "insert" | "fill" | "preserve"; fields: string[]; drift: string[] };
export type SourceBackfillReport = { ok: boolean; counts: Record<Plan["action"], number>; plan: Plan[] };

// Called only by the explicit one-time operator command. Never by catalogue backfill or deploy.
export async function backfillSources(db: PrismaClient, inventory: readonly FestivalSource[], options: { dryRun?: boolean } = {}): Promise<SourceBackfillReport> {
  return db.$transaction(async (tx) => {
    const festivals = await tx.festival.findMany({ select: { id: true, slug: true, editions: { select: { id: true, year: true } } } });
    const existing = await tx.festivalSource.findMany();
    const festivalBySlug = new Map(festivals.map((festival) => [festival.slug, festival]));
    const rowByKey = new Map(existing.map((row) => [JSON.stringify([row.festivalSlug, row.url]), row]));
    const seen = new Set<string>();
    const operations: { where: { festivalSlug_url: { festivalSlug: string; url: string } }; create: Prisma.FestivalSourceCreateInput; patch: Prisma.FestivalSourceUpdateInput; action: Plan["action"] }[] = [];
    const plan: Plan[] = [];
    for (const source of inventory) {
      const parserKey = validateSource(source);
      const key = JSON.stringify([source.festivalSlug, source.url]);
      if (seen.has(key)) throw new Error("Duplicate source: " + key);
      seen.add(key);
      const festival = festivalBySlug.get(source.festivalSlug);
      if (!festival) throw new Error("Missing festival: " + source.festivalSlug);
      const edition = festival.editions.find((item) => item.year === source.editionYear);
      if (!edition && source.enabled) throw new Error("Missing source edition: " + key + " / " + source.editionYear);
      const row = rowByKey.get(key);
      if (row?.festivalId && row.festivalId !== festival.id) throw new Error("Source festival binding conflict: " + key);
      if (row?.editionId && row.editionId !== edition?.id) throw new Error("Source edition binding conflict: " + key);
      if (row && !row.configurationBackfilledAt && (row.editionYear !== source.editionYear || row.refreshPolicy !== source.refreshPolicy || JSON.stringify(row.strategies) !== JSON.stringify(source.strategies))) throw new Error("Legacy source configuration conflict: " + key);
      const desired = { festivalId: festival.id, editionId: edition?.id ?? null, parserKey, fetchUrl: source.fetchUrl ?? null, followLinkPattern: source.followLinkPattern ?? null, requestHeaders: source.headers ?? null, cadenceSeconds: cadence[source.refreshPolicy] };
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
      operations.push({ where: { festivalSlug_url: { festivalSlug: source.festivalSlug, url: source.url } }, create: { festival: { connect: { id: festival.id } }, ...(edition ? { edition: { connect: { id: edition.id } } } : {}), festivalSlug: source.festivalSlug, url: source.url, strategies: source.strategies, refreshPolicy: source.refreshPolicy, enabled: source.enabled, editionYear: source.editionYear, manualReviewReason: source.manualReviewReason, parserKey, fetchUrl: source.fetchUrl, followLinkPattern: source.followLinkPattern, requestHeaders: source.headers, cadenceSeconds: cadence[source.refreshPolicy], configurationBackfilledAt: new Date() }, patch: { ...patch, configurationBackfilledAt: new Date() }, action });
    }
    if (!options.dryRun) for (const operation of operations) {
      if (operation.action === "insert") await tx.festivalSource.create({ data: operation.create });
      else if (operation.action === "fill") await tx.festivalSource.update({ where: operation.where, data: operation.patch });
    }
    return { ok: plan.every((entry) => !entry.drift.length), counts: { insert: plan.filter((entry) => entry.action === "insert").length, fill: plan.filter((entry) => entry.action === "fill").length, preserve: plan.filter((entry) => entry.action === "preserve").length }, plan };
  }, { timeout: 30000 });
}
