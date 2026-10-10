import { z } from "zod";
import { db } from "@/lib/db";
import {
  agentAuthorized,
  ImportAgentError,
} from "@/lib/ingestion/agent-contract";
import {
  listAgentIssues,
  claimAgentIssue,
  resolveAgentIssue,
  releaseAgentIssue,
  resumeAgentIssue,
} from "@/lib/ingestion/agent-issues";
import { listParserRepairs, claimParserRepair, finishParserRepair, configureParserRepair, configureParserRepairSource } from "@/lib/ingestion/parser-repairs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("repair_retarget"), repairId: digest, leaseToken: z.string().uuid(), decision: z.unknown(), commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
  z.object({ operation: z.literal("repair_configure"), repairId: digest, leaseToken: z.string().uuid(),
    expectedParserKey: z.string().min(1).max(160), followLinkPattern: z.string().min(1).max(256).nullable() }).strict(),
  z.object({ operation: z.literal("repair_claim"), repairId: digest }).strict(),
  z.object({ operation: z.literal("repair_finish"), repairId: digest, leaseToken: z.string().uuid(),
    result: z.object({ status: z.enum(["completed", "retry"]), reason: z.string().min(10).max(2000),
      prUrl: z.string().regex(/^https:\/\/github\.com\/KirDE\/festival-radar\/pull\/\d+$/).optional(),
      commit: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict() }).strict(),
  z
    .object({
      operation: z.literal("resume"),
      sourceId: id,
      issueId: digest,
      answer: z.string().trim().min(10).max(2000),
    })
    .strict(),
  z
    .object({ operation: z.literal("claim"), sourceId: id, issueId: digest })
    .strict(),
  z
    .object({
      operation: z.literal("release"),
      issueId: digest,
      leaseToken: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("resolve"),
      sourceId: id,
      issueId: digest,
      leaseToken: z.string().uuid(),
      snapshot: digest,
      decision: z.unknown(),
    })
    .strict(),
]);
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers });
const failure = (cause: unknown) =>
  cause instanceof ImportAgentError
    ? reply({ error: cause.code }, cause.code === "invalid" ? 400 : 409)
    : cause instanceof z.ZodError || cause instanceof SyntaxError
      ? reply({ error: "Invalid agent request" }, 400)
      : reply({ error: "Import agent service unavailable" }, 503);
export async function GET(request: Request) {
  if (!agentAuthorized(request)) return reply({ error: "Unauthorized" }, 401);
  try {
    const mode = new URL(request.url).searchParams.get("mode");
    const result = mode?.startsWith("repairs") ? await listParserRepairs(db) : await listAgentIssues(db);
    return reply(
      ["signal", "repairs-signal"].includes(mode ?? "")
        ? {
            complete: result.complete,
            ready: result.ready,
            revision: result.revision,
          }
        : result,
    );
  } catch (cause) {
    return failure(cause);
  }
}
export async function POST(request: Request) {
  if (!agentAuthorized(request)) return reply({ error: "Unauthorized" }, 401);
  try {
    // Bound the stream itself: a forged Content-Length cannot bypass the cap.
    if (!request.body) return reply({ error: "Invalid agent request" }, 400);
    const reader = request.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return reply({ error: "Request too large" }, 413);
      }
      chunks.push(value);
    }
    const parsed = requestSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (!parsed.success) return reply({ error: "Invalid agent request" }, 400);
    if (parsed.data.operation === "repair_retarget") return reply(await configureParserRepairSource(db, parsed.data.repairId, parsed.data.leaseToken, parsed.data.decision, parsed.data.commit));
    if (parsed.data.operation === "repair_configure") return reply(await configureParserRepair(db, parsed.data));
    if (parsed.data.operation === "repair_claim") return reply(await claimParserRepair(db, parsed.data.repairId));
    if (parsed.data.operation === "repair_finish") return reply(await finishParserRepair(db, parsed.data.repairId, parsed.data.leaseToken, parsed.data.result));
    if (parsed.data.operation === "claim")
      return reply(
        await claimAgentIssue(db, parsed.data.sourceId, parsed.data.issueId),
      );
    if (parsed.data.operation === "resume")
      return reply(
        await resumeAgentIssue(
          db,
          parsed.data.sourceId,
          parsed.data.issueId,
          parsed.data.answer,
        ),
      );
    if (parsed.data.operation === "release")
      return reply(
        await releaseAgentIssue(
          db,
          parsed.data.issueId,
          parsed.data.leaseToken,
        ),
      );
    return reply(await resolveAgentIssue(db, parsed.data));
  } catch (cause) {
    return failure(cause);
  }
}
