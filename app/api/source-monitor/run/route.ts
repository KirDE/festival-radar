import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { error } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
const execute = promisify(execFile);

export async function POST(request: Request) {
  if (!process.env.INTERNAL_API_SECRET || request.headers.get("authorization") !== "Bearer " + process.env.INTERNAL_API_SECRET) return error("Unauthorized.", 401);
  if (!process.env.DATABASE_URL) return error("Database source monitor unavailable.", 503);
  try {
    let stdout: string;
    try {
      ({ stdout } = await execute(process.execPath, ["--experimental-strip-types", "scripts/check-festival-sources.mjs"], {
        cwd: process.cwd(), env: process.env, timeout: 500_000, maxBuffer: 32_768,
      }));
    } catch (cause) {
      // A source can require review (exit 1) and still emit a complete audit.
      if (!(cause && typeof cause === "object" && "code" in cause && cause.code === 1 && "stdout" in cause && typeof cause.stdout === "string")) throw cause;
      stdout = cause.stdout;
    }
    const report: unknown = JSON.parse(stdout);
    if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("Invalid monitor report");
    const value = report as Record<string, unknown>;
    if (!(value.status === "OK" || value.status === "REVIEW_REQUIRED") || !Number.isSafeInteger(value.checked) || (value.checked as number) < 1 ||
      !Number.isSafeInteger(value.reviewRequired) || (value.reviewRequired as number) < 0 || !Number.isSafeInteger(value.restricted) ||
      (value.restricted as number) < 0 || !["ok", "skipped", "review-required"].includes(value.setlist as string)) throw new Error("Invalid monitor report");
    return Response.json({ status: value.status, checked: value.checked, reviewRequired: value.reviewRequired, restricted: value.restricted, setlist: value.setlist });
  } catch {
    // Never expose DB connections, URLs or fetch exceptions.
    return error("Source monitor failed.", 500);
  }
}
