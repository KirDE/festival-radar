import { createHash } from "node:crypto";
import https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { checkServerIdentity } from "node:tls";
import { performance } from "node:perf_hooks";

const TARGET = "https://www.novarock.at/lineup/";
const HOST = "www.novarock.at";
const MAX_BYTES = 512 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_HEADER_PAIRS = 100;
const TOTAL_TIMEOUT_MS = 20_000;

export type NovaRockTransportResult = {
  authority: "NONE";
  status: "TRANSPORT_COMPLETE_NON_AUTHORIZING";
  target: typeof TARGET;
  rawBytes: Uint8Array;
  rawDocumentSha256: string;
  completedAt: Date;
};

// Read rawHeaders: Node's normalized headers can hide duplicate singleton fields.
// Absent Content-Encoding is HTTP identity; any declared encoding must be
// exactly identity. Require Content-Length or chunked framing and explicit UTF-8.
function responseLength(response: IncomingMessage): number | undefined {
  if (response.statusCode !== 200) throw new Error("expected HTTP 200");
  const raw = response.rawHeaders;
  if (raw.length % 2 || raw.length > MAX_HEADER_PAIRS * 2) throw new Error("header count bound");
  const headers = new Map<string, string[]>();
  let size = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i], value = raw[i + 1];
    size += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (size > MAX_HEADER_BYTES) throw new Error("header byte bound");
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) {
      throw new Error("malformed header");
    }
    const key = name.toLowerCase();
    headers.set(key, [...(headers.get(key) ?? []), value.trim()]);
  }
  const singleton = (key: string, required = false) => {
    const values = headers.get(key);
    if (values && values.length !== 1) throw new Error(`duplicate ${key}`);
    if (required && !values) throw new Error(`missing ${key}`);
    return values?.[0];
  };
  const type = singleton("content-type", true)!;
  if (!/^text\/html\s*;\s*charset\s*=\s*(?:utf-8|"utf-8")$/i.test(type)) throw new Error("expected HTML UTF-8");
  const encoding = singleton("content-encoding");
  if (encoding !== undefined && encoding.toLowerCase() !== "identity") throw new Error("expected identity encoding");
  if (singleton("location") !== undefined) throw new Error("redirect location refused");
  if (singleton("content-range") !== undefined || singleton("trailer") !== undefined) throw new Error("partial or trailer response refused");
  const length = singleton("content-length"), transfer = singleton("transfer-encoding");
  if ((length === undefined) === (transfer === undefined)) throw new Error("missing or ambiguous framing");
  if (transfer !== undefined) {
    if (transfer.toLowerCase() !== "chunked") throw new Error("unsupported transfer encoding");
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(length!)) throw new Error("malformed content-length");
  const count = Number(length);
  if (!Number.isSafeInteger(count) || count === 0 || count > MAX_BYTES) throw new Error("body byte bound");
  return count;
}

/** Standalone transport prerequisite only. No actor, seal, evidence persistence,
 * card verification or authenticated capture is established by this result.
 * Tests mock node:https.request itself; there is no injectable production seam.
 */
export async function fetchNovaRockLineupTransport(): Promise<NovaRockTransportResult> {
  if (arguments.length !== 0) throw new Error("Nova HTTPS transport: no arguments accepted");
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + TOTAL_TIMEOUT_MS;
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      response?.destroy();
      request?.destroy();
      reject(new Error(`Nova HTTPS transport: ${reason}`));
    };
    const timely = () => {
      if (settled) return false;
      if (performance.now() >= deadline) { fail("total deadline exceeded"); return false; }
      return true;
    };
    // Starts before request construction, so DNS and TLS share the body deadline.
    const timer = setTimeout(() => fail("total deadline exceeded"), TOTAL_TIMEOUT_MS);
    try {
      request = https.request(TARGET, {
        method: "GET",
        agent: false,
        rejectUnauthorized: true,
        servername: HOST,
        checkServerIdentity,
        minVersion: "TLSv1.2",
        maxHeaderSize: MAX_HEADER_BYTES,
        insecureHTTPParser: false,
        headers: { Accept: "text/html", "Accept-Encoding": "identity" },
      });
      request.on("error", () => fail("request or TLS failure"));
      request.on("close", () => { if (!response) fail("request closed before response"); });
      request.on("information", () => fail("interim response refused"));
      request.on("upgrade", (_res, socket) => { socket.destroy(); fail("protocol upgrade refused"); });
      request.on("response", (incoming) => {
        if (response || !timely()) { incoming.destroy(); fail("multiple responses"); return; }
        response = incoming;
        incoming.on("error", () => fail("response stream failure"));
        incoming.on("aborted", () => fail("response aborted"));
        incoming.on("close", () => fail("response closed before completion"));
        const socket = incoming.socket;
        if (!("encrypted" in socket) || socket.encrypted !== true || !("authorized" in socket) || socket.authorized !== true) {
          fail("unverified TLS socket"); return;
        }
        let expectedLength: number | undefined;
        try { expectedLength = responseLength(incoming); }
        catch (error) { fail((error as Error).message); return; }
        incoming.on("data", (chunk: unknown) => {
          if (!timely()) return;
          if (!Buffer.isBuffer(chunk)) { fail("non-byte stream"); return; }
          size += chunk.byteLength;
          if (size > MAX_BYTES || expectedLength !== undefined && size > expectedLength) { fail("body byte bound"); return; }
          chunks.push(Buffer.from(chunk));
        });
        incoming.on("end", () => {
          if (!timely()) return;
          if (!incoming.complete || incoming.aborted || !size || expectedLength !== undefined && size !== expectedLength || incoming.rawTrailers.length) {
            fail("incomplete or ambiguous response"); return;
          }
          const rawBytes = Uint8Array.from(Buffer.concat(chunks, size));
          chunks.length = 0;
          try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes); }
          catch { fail("invalid UTF-8 bytes"); return; }
          const rawDocumentSha256 = createHash("sha256").update(rawBytes).digest("hex");
          if (!timely()) return;
          const completedAt = new Date();
          settled = true;
          clearTimeout(timer);
          resolve({ authority: "NONE", status: "TRANSPORT_COMPLETE_NON_AUTHORIZING", target: TARGET,
            rawBytes, rawDocumentSha256, completedAt });
        });
      });
      if (timely()) request.end();
    } catch { fail("request construction failure"); }
  });
}
