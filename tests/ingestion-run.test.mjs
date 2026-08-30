import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runIngestion } from "../lib/ingestion/run.ts";

const festival = { slug: "example", name: "Example", officialUrl: "https://example.test", startDate: "2027-06-01", endDate: "2027-06-02", city: "Example", country: "DE", headliners: [], lineup: [], genres: [], status: "announced" };
const source = { festivalSlug: "example", url: festival.officialUrl, strategies: ["html_fallback"], refreshPolicy: "daily", enabled: true };
const html = `<html><body><h1>Example</h1><time datetime="2027-06-01"></time><time datetime="2027-06-02"></time></body></html>`;
const response = (status, body = "") => new Response(body, { status });

async function execute(sequence, threshold = 3, stateFile) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "festival-ingestion-"));
  const requests = [...sequence];
  const delays = [];
  const summary = await runIngestion({ sources: [source], festivals: [festival], outputDirectory: directory, stateFile: stateFile ?? path.join(directory, "state.json"), failureThreshold: threshold, now: () => new Date("2026-08-30T03:00:00Z"), fetchOptions: { fetchImpl: async () => requests.shift(), sleep: async (delay) => delays.push(delay), baseDelayMs: 10 } });
  return { summary, directory, delays };
}

test("403 is retried with bounded exponential backoff and can recover", async () => {
  const result = await execute([response(403), response(403), response(200, html)]);
  assert.equal(result.summary.status, "healthy");
  assert.deepEqual(result.delays, [10, 20]);
  assert.equal(result.summary.results[0].attempts, 3);
});

test("source-specific headers and approved fetch URL are passed to the adapter", async () => {
  let request;
  await runIngestion({ sources: [{ ...source, fetchUrl: "https://feed.example.test/", headers: { "x-source": "approved" } }], festivals: [festival], outputDirectory: await mkdtemp(path.join(os.tmpdir(), "festival-header-")), stateFile: path.join(await mkdtemp(path.join(os.tmpdir(), "festival-header-state-")), "state.json"), failureThreshold: 3, fetchOptions: { fetchImpl: async (url, options) => { request = { url: String(url), headers: new Headers(options.headers) }; return response(200, html); } } });
  assert.equal(request.url, "https://feed.example.test/");
  assert.equal(request.headers.get("x-source"), "approved");
});

test("persistent failure degrades before the configured escalation threshold", async () => {
  const result = await execute([response(403), response(403), response(403)]);
  assert.equal(result.summary.status, "degraded");
  assert.equal(result.summary.results[0].consecutiveFailures, 1);
});

test("failure state and last success persist, then escalate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "festival-health-"));
  const stateFile = path.join(root, "state.json");
  await execute([response(200, html)], 2, stateFile);
  await execute([response(403), response(403), response(403)], 2, stateFile);
  const final = await execute([response(403), response(403), response(403)], 2, stateFile);
  assert.equal(final.summary.status, "failed");
  assert.equal(final.summary.results[0].consecutiveFailures, 2);
  assert.equal(final.summary.results[0].lastSuccessfulCheck, "2026-08-30T03:00:00.000Z");
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(persisted.sources.example.consecutiveFailures, 2);
});

test("mixed results retain successes and report partial degradation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "festival-mixed-"));
  const responses = [response(200, html), response(403), response(403), response(403)];
  const secondSource = { ...source, festivalSlug: "other", url: "https://other.test" };
  const summary = await runIngestion({ sources: [source, secondSource], festivals: [festival, { ...festival, slug: "other" }], outputDirectory: directory, stateFile: path.join(directory, "state.json"), failureThreshold: 3, fetchOptions: { fetchImpl: async () => responses.shift(), sleep: async () => {}, baseDelayMs: 0 } });
  assert.equal(summary.status, "degraded");
  assert.equal(summary.processed, 1);
  assert.equal(summary.fetchErrors, 1);
  assert.equal(summary.results[0].festivalSlug, "example");
});
