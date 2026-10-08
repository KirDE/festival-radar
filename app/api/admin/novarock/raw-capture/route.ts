import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin-access";
import { requestHasTrustedOrigin } from "@/lib/request-origin";
import { captureNovaRockRawCards } from "@/lib/ingestion/novarock-authenticated-raw-capture";

export const runtime = "nodejs";
export async function POST(request: Request) {
  // This prerequisite is not deploy-ready: no cross-process rate limiter or
  // independent DB-writer provenance boundary. Explicit local opt-in only.
  if (process.env.NOVA_ROCK_RAW_CAPTURE_ENABLED !== "true")
    return NextResponse.json({ authority: "NONE", error: "Capture unavailable." }, { status: 404 });
  if (!process.env.APP_URL || !requestHasTrustedOrigin(request, process.env.APP_URL))
    return NextResponse.json({ error: "Untrusted origin." }, { status: 403 });
  if (!await currentAdmin(["ADMIN"]))
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const length = request.headers.get("content-length");
  if (!request.headers.get("content-type")?.match(/^application\/json(?:;\s*charset=utf-8)?$/i) ||
      length !== null && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > 512))
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  // Bound the *stream*, not just the declared length or resulting JS string.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 512) { await reader.cancel(); return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
      chunks.push(value);
    }
  } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const rawBytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { rawBytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  // A literal, single-field grammar rejects duplicate JSON keys and escaped
  // aliases; there is no ambiguity about which seal the caller selected.
  const match = /^\s*\{\s*"sealId"\s*:\s*"([a-zA-Z0-9_-]{1,200})"\s*\}\s*$/.exec(raw);
  if (!match) return NextResponse.json({ error: "Only exact sealId is accepted." }, { status: 400 });
  try {
    return NextResponse.json(await captureNovaRockRawCards(match[1]), { status: 201 });
  } catch {
    // Do not leak session, source or transport details to the response.
    return NextResponse.json({ authority: "NONE", error: "Capture rejected; no evidence recorded." }, { status: 409 });
  }
}
