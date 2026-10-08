import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { checkServerIdentity } from "node:tls";
import test, { type TestContext } from "node:test";
import { fetchNovaRockLineupTransport } from "../lib/ingestion/novarock-https-transport.ts";

// All HTTPS requests in this file are mocked. These synthetic bytes prove only
// transport behavior, never official-host acquisition or authenticated capture.
const bytes = Buffer.from('\uFEFF<!doctype html>\r\n<html>Grüße 🎸</html>\n');
const maxBytes = 512 * 1024;
const headers = () => ["Content-Type", "text/html; charset=UTF-8", "Content-Encoding", "identity", "Content-Length", String(bytes.length)];

class ResponseDouble extends EventEmitter {
  statusCode: number | undefined = 200;
  rawHeaders = headers();
  rawTrailers: string[] = [];
  complete = true;
  aborted = false;
  socket = { encrypted: true, authorized: true };
  destroyed = false;
  destroy() { this.destroyed = true; return this; }
}
class RequestDouble extends EventEmitter {
  destroyed = false;
  ended = 0;
  end() { this.ended++; return this; }
  destroy() { this.destroyed = true; return this; }
}
function setup(t: TestContext) {
  const request = new RequestDouble();
  const response = new ResponseDouble();
  const calls: unknown[][] = [];
  t.mock.method(https, "request", (...args: unknown[]) => { calls.push(args); return request; });
  const promise = fetchNovaRockLineupTransport();
  const deliver = () => request.emit("response", response);
  const finish = (body = bytes) => { response.emit("data", body); response.emit("end"); };
  return { request, response, promise, deliver, finish, calls };
}

test("one literal direct GET, verified TLS, fixed headers, original copied bytes/hash and completion time", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  const s = setup(t);
  assert.equal(fetchNovaRockLineupTransport.length, 0);
  assert.deepEqual(s.calls, [["https://www.novarock.at/lineup/", {
    method: "GET", agent: false, rejectUnauthorized: true, servername: "www.novarock.at",
    checkServerIdentity, minVersion: "TLSv1.2", maxHeaderSize: 16 * 1024,
    insecureHTTPParser: false, headers: { Accept: "text/html", "Accept-Encoding": "identity" },
  }]]);
  assert.equal(s.request.ended, 1);
  const original = Buffer.from(bytes);
  const first = Buffer.from(bytes.subarray(0, 17));
  s.deliver();
  s.response.emit("data", first);
  first.fill(0); // Cannot mutate already received bytes through a reused buffer.
  s.response.emit("data", bytes.subarray(17));
  t.mock.timers.tick(123);
  s.response.emit("end");
  const result = await s.promise;
  assert.deepEqual(Buffer.from(result.rawBytes), original);
  assert.equal(result.rawDocumentSha256, createHash("sha256").update(original).digest("hex"));
  assert.equal(result.completedAt.toISOString(), new Date(1_800_000_000_123).toISOString());
  assert.equal(result.authority, "NONE");
  assert.equal(result.status, "TRANSPORT_COMPLETE_NON_AUTHORIZING");
  assert.equal(result.target, "https://www.novarock.at/lineup/");
  assert.equal(s.calls.length, 1);
  t.mock.timers.tick(20_000);
  assert.equal(s.request.destroyed, false); // Success clears the deadline.
});

test("arguments cannot inject URLs, bytes, headers, credentials or a fetcher", async (t) => {
  let calls = 0;
  t.mock.method(https, "request", () => { calls++; throw new Error("must not request"); });
  const callWithInput = fetchNovaRockLineupTransport as unknown as (...args: unknown[]) => Promise<unknown>;
  for (const input of ["https://evil.invalid/", bytes, { headers: { Cookie: "injected", Authorization: "injected" } },
    { url: "https://evil.invalid/", bytes, fetcher: () => bytes }, undefined]) {
    await assert.rejects(callWithInput(input), /no arguments accepted/);
  }
  assert.equal(calls, 0);
});

test("redirects, status failures, and missing/duplicate/malformed relevant headers reject without retry", async (t) => {
  const cases: Array<[string, (r: ResponseDouble) => void]> = [];
  for (const status of [undefined, 0, 199, 201, 206, 301, 302, 303, 307, 308, 429, 503]) {
    cases.push([`status ${status}`, (r) => { r.statusCode = status; }]);
  }
  for (const name of ["Content-Type", "Content-Length"]) {
    cases.push([`missing ${name}`, (r) => { const i = r.rawHeaders.indexOf(name); r.rawHeaders.splice(i, 2); }]);
    cases.push([`duplicate ${name}`, (r) => { const i = r.rawHeaders.indexOf(name); r.rawHeaders.push(name.toLowerCase(), r.rawHeaders[i + 1]); }]);
  }
  for (const type of ["", "text/html", "text/plain; charset=utf-8", "application/xhtml+xml; charset=utf-8",
    "text/html; charset=latin1", "text/html; charset=utf-8; charset=utf-8", "text/html; charset=utf-8, text/html; charset=utf-8",
    "text/html; charset=utf-8\u00a0", "\u00a0text/html; charset=utf-8", "text/html;\u00a0charset=utf-8",
    "text/html; charset=\u00a0utf-8", "text/html; charset=utf-8\u2000", "text/html;\fcharset=utf-8"]) {
    cases.push([`type ${type}`, (r) => { r.rawHeaders[1] = type; }]);
  }
  cases.push(["duplicate Content-Encoding", (r) => { r.rawHeaders.push("content-encoding", "identity"); }]);
  for (const encoding of ["", "gzip", "br", "identity, identity"]) {
    cases.push([`encoding ${encoding}`, (r) => { r.rawHeaders[3] = encoding; }]);
  }
  for (const length of ["", "-1", "+1", "1.5", "01", "1, 1", "0", String(maxBytes + 1), "9007199254740993"]) {
    cases.push([`length ${length}`, (r) => { r.rawHeaders[5] = length; }]);
  }
  cases.push(
    ["same-host location", (r) => { r.rawHeaders.push("Location", "https://www.novarock.at/lineup/"); }],
    ["other-host location", (r) => { r.rawHeaders.push("Location", "https://evil.invalid/"); }],
    ["duplicate location", (r) => { r.rawHeaders.push("Location", "/lineup/", "location", "/lineup/"); }],
    ["ambiguous framing", (r) => { r.rawHeaders.push("Transfer-Encoding", "chunked"); }],
    ["duplicate transfer", (r) => { r.rawHeaders.splice(4, 2, "Transfer-Encoding", "chunked", "transfer-encoding", "chunked"); }],
    ["unsupported transfer", (r) => { r.rawHeaders.splice(4, 2, "Transfer-Encoding", "gzip, chunked"); }],
    ["partial content", (r) => { r.rawHeaders.push("Content-Range", "bytes 0-1/2"); }],
    ["trailer announcement", (r) => { r.rawHeaders.push("Trailer", "Content-Type"); }],
    ["invalid header name", (r) => { r.rawHeaders.push("bad name", "value"); }],
    ["invalid header value", (r) => { r.rawHeaders[1] += "\r\ninjected: value"; }],
    ["odd header list", (r) => { r.rawHeaders.push("orphan"); }],
    ["large headers", (r) => { r.rawHeaders.push("X-Large", "a".repeat(16 * 1024)); }],
    ["many headers", (r) => { for (let i = 0; i < 101; i++) r.rawHeaders.push(`X-${i}`, "x"); }],
  );
  for (const [name, change] of cases) await t.test(name, async (t) => {
    const s = setup(t);
    change(s.response);
    s.deliver();
    await assert.rejects(s.promise, /Nova HTTPS transport:/);
    assert.equal(s.request.destroyed, true);
    assert.equal(s.response.destroyed, true);
    assert.equal(s.calls.length, 1);
  });
});

test("absent Content-Encoding means identity; original bytes remain intact", async (t) => {
  const s = setup(t);
  s.response.rawHeaders.splice(2, 2);
  s.deliver();
  s.finish();
  assert.deepEqual(Buffer.from((await s.promise).rawBytes), bytes);
  assert.equal(s.calls.length, 1);
});

test("complete chunked identity HTML is accepted at the exact byte limit", async (t) => {
  const s = setup(t);
  s.response.rawHeaders.splice(4, 2, "Transfer-Encoding", "chunked");
  const body = Buffer.alloc(maxBytes, 0x61);
  s.deliver();
  s.finish(body);
  assert.deepEqual(Buffer.from((await s.promise).rawBytes), body);
});

test("partial, oversized, non-byte, malformed UTF-8 and unverified TLS responses discard all bytes", async (t) => {
  const cases: Array<[string, (s: ReturnType<typeof setup>) => void]> = [
    ["incomplete end", (s) => { s.response.complete = false; s.deliver(); s.finish(); }],
    ["short length", (s) => { s.deliver(); s.finish(bytes.subarray(1)); }],
    ["long length", (s) => { s.response.rawHeaders[5] = "1"; s.deliver(); s.finish(); }],
    ["aborted", (s) => { s.deliver(); s.response.emit("data", bytes); s.response.emit("aborted"); }],
    ["closed", (s) => { s.deliver(); s.response.emit("data", bytes); s.response.emit("close"); }],
    ["stream error", (s) => { s.deliver(); s.response.emit("error", new Error("offline")); }],
    ["trailers", (s) => { s.response.rawTrailers = ["Content-Type", "text/plain"]; s.deliver(); s.finish(); }],
    ["string chunk", (s) => { s.deliver(); s.response.emit("data", bytes.toString()); }],
    ["oversized chunked", (s) => { s.response.rawHeaders.splice(4, 2, "Transfer-Encoding", "chunked"); s.deliver(); s.finish(Buffer.alloc(maxBytes + 1)); }],
    ["oversized accumulated", (s) => { s.response.rawHeaders.splice(4, 2, "Transfer-Encoding", "chunked"); s.deliver(); s.response.emit("data", Buffer.alloc(maxBytes)); s.finish(Buffer.from("x")); }],
    ["empty chunked", (s) => { s.response.rawHeaders.splice(4, 2, "Transfer-Encoding", "chunked"); s.deliver(); s.finish(Buffer.alloc(0)); }],
    ["TLS unauthorized", (s) => { s.response.socket.authorized = false; s.deliver(); }],
    ["unencrypted socket", (s) => { s.response.socket.encrypted = false; s.deliver(); }],
  ];
  for (const bad of [[0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff]]) {
    cases.push([`invalid UTF-8 ${bad}`, (s) => { s.response.rawHeaders[5] = String(bad.length); s.deliver(); s.finish(Buffer.from(bad)); }]);
  }
  for (const [name, simulate] of cases) await t.test(name, async (t) => {
    const s = setup(t);
    simulate(s);
    await assert.rejects(s.promise, /Nova HTTPS transport:/);
    assert.equal(s.request.destroyed, true);
    assert.equal(s.response.destroyed, true);
    assert.equal(s.calls.length, 1);
  });
});

test("one total timer cancels DNS/connect/header/body stalls, with no reset or retry", async (t) => {
  for (const phase of ["DNS", "connect", "TLS", "headers", "body"]) await t.test(phase, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const s = setup(t);
    t.mock.timers.tick(10_000);
    if (phase !== "DNS") s.request.emit("socket", new EventEmitter());
    if (phase === "headers" || phase === "body") s.request.emit("finish");
    if (phase === "body") { s.deliver(); s.response.emit("data", bytes.subarray(0, 1)); }
    t.mock.timers.tick(9_999);
    assert.equal(s.request.destroyed, false);
    t.mock.timers.tick(1);
    await assert.rejects(s.promise, /total deadline exceeded/);
    assert.equal(s.request.destroyed, true);
    if (phase === "body") assert.equal(s.response.destroyed, true);
    // Late data/completion cannot rescue or change a failed operation.
    s.deliver(); s.finish();
    assert.equal(s.response.destroyed, true);
    assert.equal(s.calls.length, 1);
  });
});

test("request/TLS cancellation, protocol responses and construction errors never retry", async (t) => {
  for (const event of ["error", "close", "information", "upgrade"]) await t.test(event, async (t) => {
    const s = setup(t);
    const socket = { destroyed: false, destroy() { this.destroyed = true; } };
    s.request.emit(event, new Error("cancelled or TLS failure"), socket);
    await assert.rejects(s.promise, /Nova HTTPS transport:/);
    assert.equal(s.request.destroyed, true);
    if (event === "upgrade") assert.equal(socket.destroyed, true);
    assert.equal(s.calls.length, 1);
  });
  await t.test("synchronous construction error", async (t) => {
    let calls = 0;
    t.mock.method(https, "request", () => { calls++; throw new Error("offline"); });
    await assert.rejects(fetchNovaRockLineupTransport(), /request construction failure/);
    assert.equal(calls, 1);
  });
});

test("a delayed timer callback cannot admit headers, body or completion past the monotonic deadline", async (t) => {
  for (const phase of ["headers", "body", "end"]) await t.test(phase, async (t) => {
    let now = 0;
    t.mock.method(performance, "now", () => now);
    const s = setup(t);
    if (phase !== "headers") s.deliver();
    if (phase === "end") s.response.emit("data", bytes);
    now = 20_000;
    if (phase === "headers") s.deliver();
    if (phase === "body") s.response.emit("data", bytes);
    if (phase === "end") s.response.emit("end");
    await assert.rejects(s.promise, /total deadline exceeded/);
    assert.equal(s.request.destroyed, true);
    assert.equal(s.response.destroyed, true);
    assert.equal(s.calls.length, 1);
  });
});

test("a stalled synchronous request construction is cancelled before sending", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const request = new RequestDouble();
  t.mock.method(https, "request", () => { now = 20_000; return request; });
  await assert.rejects(fetchNovaRockLineupTransport(), /total deadline exceeded/);
  assert.equal(request.ended, 0);
  assert.equal(request.destroyed, true);
});
