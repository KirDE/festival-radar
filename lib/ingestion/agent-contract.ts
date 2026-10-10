import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function agentAuthorized(
  request: Request,
  secret = process.env.IMPORT_AGENT_SECRET,
) {
  const value = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !value.startsWith("Bearer "))
    return false;
  const actual = Buffer.from(value.slice(7)),
    expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    v instanceof Date
      ? v.toISOString()
      : Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, canonical(x)]),
            )
          : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine((v) => {
    try {
      return new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
    } catch {
      return false;
    }
  });
const name = z.string().trim().min(1).max(160);
export const factsSchema = z
  .object({
    startDate: date.optional(),
    endDate: date.optional(),
    city: name.optional(),
    status: z.enum(["confirmed", "partial", "tba"]).optional(),
    ticketStatus: z
      .enum(["available", "low", "unavailable", "unknown"])
      .optional(),
    ticketsUrl: z.string().url().max(2048).optional(),
    headliners: z.array(name).max(300).optional(),
    lineup: z.array(name).max(300).optional(),
  })
  .strict()
  .refine(
    (v) => (v.headliners === undefined) === (v.lineup === undefined),
    "Both billing groups are required for a reviewed lineup",
  );
export const evidenceSchema = z
  .object({
    field: z.string().min(1).max(40),
    url: z.string().url().max(2048),
    checkedAt: z.string().datetime(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    excerpt: z.string().trim().min(1).max(2000),
  })
  .strict();
export const decisionSchema = z
  .object({
    action: z.enum(["apply", "dismiss", "retry", "needs_user"]),
    reason: z.string().trim().min(10).max(2000),
    facts: factsSchema.optional(),
    source: z
      .object({
        url: z.string().url().max(2048),
        strategies: z
          .array(
            z.enum([
              "official_markup",
              "json_ld_event",
              "html_fallback",
              "manual_review",
            ]),
          )
          .min(1)
          .max(3),
        refreshPolicy: z.enum(["daily", "every_3_days", "weekly"]),
        manualReviewReason: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
    evidence: z.array(evidenceSchema).max(30).default([]),
    question: z.string().trim().min(10).max(1000).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.action !== "apply" && (v.facts || v.source))
      c.addIssue({
        code: "custom",
        message: "Only apply may change facts or source",
      });
    if (v.action === "apply" && !v.evidence.length)
      c.addIssue({
        code: "custom",
        message: "Apply requires official evidence",
      });
    if (v.action === "needs_user" && !v.question)
      c.addIssue({
        code: "custom",
        message: "Concrete user question required",
      });
  });
export type AgentDecision = z.infer<typeof decisionSchema>;
export class ImportAgentError extends Error {
  code: "stale" | "busy" | "missing" | "invalid";
  constructor(code: "stale" | "busy" | "missing" | "invalid") {
    super(code);
    this.code=code;
  }
}
