import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClaimedSource } from "./lease.ts";

const configurationSchema = z.object({
  sourceId: z.string().min(1), festivalId: z.string().min(1), festivalSlug: z.string().min(1),
  editionId: z.string().min(1), editionYear: z.number().int(), editionRecordState: z.enum(["CURRENT", "ARCHIVED", "TRACKING"]),
  url: z.string().url(), parserKey: z.string().min(1), strategies: z.array(z.string().min(1)).min(1),
  fetchUrl: z.string().nullable(), followLinkPattern: z.string().nullable(),
  requestHeaders: z.record(z.string(), z.string()).nullable(), enabled: z.literal(true),
  refreshPolicy: z.string(), cadenceSeconds: z.number().int().positive(), manualReviewReason: z.string().nullable(),
  configurationBackfilledAt: z.string().datetime(),
}).strict();
const provenanceSchema = z.object({
  version: z.literal(1), configuration: configurationSchema,
  configurationDigest: z.string().regex(/^[a-f0-9]{64}$/), configurationGeneration: z.number().int().positive(),
  leaseOwner: z.string().uuid(), leaseVersion: z.number().int().positive(), claimedAt: z.string().datetime(),
}).strict();
export type AcquisitionProvenance = z.infer<typeof provenanceSchema>;

/** Sort object keys recursively; preserve ordered parser strategies. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(configuration: AcquisitionProvenance["configuration"]): string {
  return createHash("sha256").update(canonical(configuration)).digest("hex");
}

/** Capture only from the row returned by atomic claim, never a post-fetch reread. */
function sourceConfiguration(row: ClaimedSource): AcquisitionProvenance["configuration"] {
  if (!row.edition || row.edition.festivalId !== row.festivalId || row.edition.year !== row.editionYear) throw new Error("Invalid claimed edition binding");
  return configurationSchema.parse({
    sourceId: row.id, festivalId: row.festivalId, festivalSlug: row.festivalSlug,
    editionId: row.editionId, editionYear: row.editionYear, editionRecordState: row.edition.recordState,
    url: row.url, parserKey: row.parserKey, strategies: row.strategies,
    fetchUrl: row.fetchUrl, followLinkPattern: row.followLinkPattern, requestHeaders: row.requestHeaders,
    enabled: row.enabled, refreshPolicy: row.refreshPolicy, cadenceSeconds: row.cadenceSeconds,
    manualReviewReason: row.manualReviewReason, configurationBackfilledAt: row.configurationBackfilledAt?.toISOString(),
  });
}

export function captureAcquisitionProvenance(row: ClaimedSource): AcquisitionProvenance {
  const configuration = sourceConfiguration(row);
  return provenanceSchema.parse({ version: 1, configuration, configurationDigest: digest(configuration),
    configurationGeneration: row.configurationGeneration, leaseOwner: row.leaseOwner,
    leaseVersion: row.leaseVersion, claimedAt: row.updatedAt.toISOString() });
}

/** Historical/null, malformed, unsupported and tampered payloads fail closed. No backfill. */
export function readAcquisitionProvenance(value: unknown): AcquisitionProvenance | null {
  const parsed = provenanceSchema.safeParse(value);
  return parsed.success && digest(parsed.data.configuration) === parsed.data.configurationDigest ? parsed.data : null;
}

/** Comparison primitive only, not review or publication authority. Caller must lock first.
 * Lease expiry/quiescence, newer attempts and catalogue/review checks remain future work. */
export function acquisitionMatchesSource(value: unknown, row: ClaimedSource): boolean {
  const acquired = readAcquisitionProvenance(value);
  if (!acquired) return false;
  try {
    return digest(sourceConfiguration(row)) === acquired.configurationDigest &&
      row.configurationGeneration === acquired.configurationGeneration &&
      row.leaseVersion === acquired.leaseVersion &&
      (row.leaseOwner === null || row.leaseOwner === acquired.leaseOwner);
  } catch { return false; }
}
