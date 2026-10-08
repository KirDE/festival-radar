import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../../../../lib/db.ts";
import { ACTIVATION } from "../../../../lib/operations/rockharz-2027-plan.ts";
import { GuardRejected, guardedRockharzUpdate } from "../../../../lib/operations/rockharz-2027-update.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const schema = z.object({ operation: z.enum(["inspect", "activate", "readback"]),
  expectedCommit: z.string().regex(/^[a-f0-9]{40}$/), planHash: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.string().regex(/^\d+:\d+$/).max(60), activation: z.literal(ACTIVATION).optional(),
}).strict();
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  // Dedicated scope: no session, admin role or shared INTERNAL_API_SECRET fallback.
  const secret = process.env.ROCKHARZ_2027_UPDATE_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !/^[a-f0-9]{64}$/.test(secret) || secret === process.env.INTERNAL_API_SECRET
    || process.env.ROCKHARZ_2027_UPDATE_ACTIVATION !== ACTIVATION
    || !/^Bearer [a-f0-9]{64}$/.test(authorization)
    || !timingSafeEqual(Buffer.from(authorization), Buffer.from(`Bearer ${secret}`))) return reply({ error: "Unauthorized" }, 401);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply({ error: "JSON required" }, 415);
  // Bound even chunked requests; don't buffer arbitrary authenticated input.
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Invalid request" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) { await reader.cancel(); return reply({ error: "Request too large" }, 413); }
      chunks.push(next.value);
    }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return reply({ error: "Invalid request" }, 400);
    if (!process.env.DEPLOYED_COMMIT || parsed.data.expectedCommit !== process.env.DEPLOYED_COMMIT) return reply({ error: "Deployed commit differs" }, 409);
    return reply(await guardedRockharzUpdate(db, parsed.data));
  } catch (cause) {
    if (cause instanceof SyntaxError) return reply({ error: "Invalid request" }, 400);
    if (cause instanceof GuardRejected) return reply({ error: cause.message }, 409);
    // Never emit Prisma, credentials, provider data or connection details.
    return reply({ error: "Guarded update failed; inspect authenticated readback before any retry" }, 500);
  }
}
