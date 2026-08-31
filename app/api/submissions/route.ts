import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const reply = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  let data: Record<string, unknown>;
  try { data = await request.json(); } catch { return reply({ error: "Invalid JSON request." }, 400); }
  if (data.website) return reply({ error: "Invalid submission." }, 400);
  const name = typeof data.name === "string" ? data.name.trim().replace(/\s+/g, " ") : "";
  const notes = typeof data.notes === "string" ? data.notes.trim() : "";
  const editionYear = Number(data.year);
  let url: URL;
  try { url = new URL(String(data.officialUrl)); } catch { return reply({ error: "A valid official URL is required." }, 422); }
  url.hash = ""; url.hostname = url.hostname.toLowerCase();
  if (name.length < 2 || name.length > 100 || notes.length > 1000 || !Number.isInteger(editionYear) || editionYear < 2027 || editionYear > 2100 || !["http:", "https:"].includes(url.protocol)) return reply({ error: "Check the festival name, year, official URL, and notes." }, 422);
  const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const salt = process.env.SUBMISSION_HASH_SALT || process.env.AUTH_SECRET;
  if (!salt) return reply({ error: "Submission service is not configured." }, 503);
  const submitterHash = digest(`${salt}:${source}`);
  const fingerprint = digest(`${name.toLocaleLowerCase("en")}|${editionYear}|${url.hostname.replace(/^www\./, "")}`);
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${submitterHash}))`;
      if (await tx.festivalSubmission.count({ where: { submitterHash, submittedAt: { gte: new Date(Date.now() - 3_600_000) } } }) >= 5) return { limited: true } as const;
      const existing = await tx.festivalSubmission.findUnique({ where: { fingerprint } });
      if (existing) return { submission: existing, duplicate: true } as const;
      const submission = await tx.festivalSubmission.create({ data: { publicReference: randomBytes(18).toString("base64url"), fingerprint, name, editionYear, officialUrl: url.toString(), notes: notes || null, submitterHash, audit: { create: { action: "SUBMITTED", detail: { source: "public-form" } } } } });
      return { submission, duplicate: false } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("limited" in result) return reply({ error: "Too many submissions. Try again later." }, 429);
    return reply({ accepted: true, reference: result.submission.publicReference, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch { return reply({ error: "The submission could not be saved. Please try again." }, 503); }
}
