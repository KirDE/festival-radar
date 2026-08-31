import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { error } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_200;

const execute = promisify(execFile);
const input = z.object({ festival: z.string().trim().min(1).max(120).nullable().optional() });

export async function POST(request: Request) {
  if (!process.env.INTERNAL_API_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.INTERNAL_API_SECRET}`) return error("Unauthorized.", 401);
  if (!process.env.DATABASE_URL) return error("Durable ingestion is unavailable.", 503);
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid ingestion request.");

  const executionId = randomUUID();
  const outputDirectory = path.join("/opt/festival-radar/shared/ingestion", executionId);
  await mkdir(outputDirectory, { recursive: true });
  const args = ["--experimental-strip-types", "scripts/ingest-festivals.mjs", "--due", "--publish", `--output=${outputDirectory}`, "--max-fetch-errors=10"];
  if (parsed.data.festival) args.push(`--slug=${parsed.data.festival}`);
  try {
    await execute(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: process.env.DEPLOYED_COMMIT ?? "production" },
      timeout: 1_100_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const summary = JSON.parse(await readFile(path.join(outputDirectory, "summary.json"), "utf8"));
    if (!summary.ingestionRunId) throw new Error("Runner did not create a durable ingestion run");
    const persisted = await db.ingestionRun.findUnique({
      where: { id: summary.ingestionRunId },
      include: { attempts: { include: { candidate: { include: { evidence: true, diffs: true } } } } },
    });
    if (!persisted || persisted.attempts.length !== summary.attempted) throw new Error("Durable ingestion read-back mismatch");
    const successfulAttempt = persisted.attempts.find((attempt) => attempt.candidate);
    const failedAttempt = persisted.attempts.find((attempt) => attempt.status === "FAILED");
    const sourceState = successfulAttempt ? await db.ingestionSourceState.findUnique({ where: { festivalSlug: successfulAttempt.festivalSlug } }) : null;
    return Response.json({
      runId: persisted.id,
      summary,
      readBack: {
        status: persisted.status,
        attempts: persisted.attempts.length,
        candidates: persisted.attempts.filter((attempt) => attempt.candidate).length,
        evidence: persisted.attempts.reduce((total, attempt) => total + (attempt.candidate?.evidence.length ?? 0), 0),
        diffs: persisted.attempts.reduce((total, attempt) => total + (attempt.candidate?.diffs.length ?? 0), 0),
        hasPersistedFailure: Boolean(failedAttempt),
        lastSuccessfulCheck: sourceState?.lastSuccessfulCheck?.toISOString() ?? null,
      },
    });
  } catch (cause) {
    console.error("Production ingestion failed", cause instanceof Error ? cause.message : "unknown error");
    return error("Production ingestion failed.", 500);
  }
}
