import { Prisma, PrismaClient, type FestivalSource as SourceRow } from "@prisma/client";
import { hasOfficialMarkupAdapter } from "../ingestion/adapters/official-markup.ts";
import type { FestivalSource, ParserStrategy, RefreshPolicy } from "../ingestion/types.ts";

type Database = PrismaClient | Prisma.TransactionClient;
const strategies: ParserStrategy[] = ["json_ld_event", "html_fallback", "official_markup", "manual_review"];
const cadence: Record<RefreshPolicy, number> = { daily: 86400, every_3_days: 259200, weekly: 604800, archived: 2592000 };
const policies = Object.keys(cadence);
class SourceValidationError extends Error {}

function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password && !/[\u0000-\u001f\u007f]/.test(value);
  } catch { return false; }
}

export function sourceParserKey(source: Pick<FestivalSource, "festivalSlug" | "strategies">): string {
  if (!Array.isArray(source.strategies) || !source.strategies.length || source.strategies.some((value) => !strategies.includes(value)) || new Set(source.strategies).size !== source.strategies.length) throw new SourceValidationError("Invalid parser strategies");
  if (source.strategies.includes("manual_review") && source.strategies.length !== 1) throw new SourceValidationError("Manual parser cannot be combined");
  if (source.strategies.includes("official_markup") && !hasOfficialMarkupAdapter(source.festivalSlug)) throw new SourceValidationError("Unknown official parser for " + source.festivalSlug);
  return source.strategies.join("+") + (source.strategies.includes("official_markup") ? ":" + source.festivalSlug : "");
}

export function validateSource(source: FestivalSource & { parserKey?: string }): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source.festivalSlug)) throw new SourceValidationError("Invalid festival slug");
  if (!validUrl(source.url) || (source.fetchUrl !== undefined && !validUrl(source.fetchUrl))) throw new SourceValidationError("Invalid source or fetch URL");
  if (!Number.isInteger(source.editionYear) || source.editionYear < 2000 || source.editionYear > 2100) throw new SourceValidationError("Invalid source edition");
  if (!policies.includes(source.refreshPolicy)) throw new SourceValidationError("Invalid refresh policy");
  if (typeof source.enabled !== "boolean") throw new SourceValidationError("Invalid source enabled flag");
  if (source.followLinkPattern !== undefined) {
    const pattern = source.followLinkPattern;
    if (!pattern || pattern.length > 256 || !pattern.startsWith("^") || !pattern.endsWith("$") || /[()|]/.test(pattern) || /\\[1-9]/.test(pattern)) throw new SourceValidationError("Unsafe follow-link regex");
    try { new RegExp(pattern, "i"); } catch { throw new SourceValidationError("Invalid follow-link regex"); }
  }
  if (source.headers !== undefined && (!source.headers || typeof source.headers !== "object" || Array.isArray(source.headers) || Object.entries(source.headers).some(([key, value]) => !/^[a-z0-9-]+$/i.test(key) || typeof value !== "string" || /[\r\n]/.test(value)))) throw new SourceValidationError("Invalid request headers");
  const key = sourceParserKey(source);
  if (source.parserKey !== undefined && source.parserKey !== key) throw new SourceValidationError("Unknown or mismatched parser key: " + source.parserKey);
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
