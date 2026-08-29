import assert from "node:assert/strict";
import { test } from "node:test";
import { extractHtmlFallbackCandidate } from "../lib/ingestion/adapters/html-fallback.ts";

const source = {
  festivalSlug: "example-fest",
  url: "https://festival.example/2027/",
  strategies: ["html_fallback"],
  refreshPolicy: "daily",
  enabled: true,
};

test("HTML fallback extracts only explicitly marked festival data", () => {
  const html = `
    <meta property="event:start_time" content="2027-07-01T16:00:00+02:00">
    <time class="festival-end" datetime="2027-07-03">3 July</time>
    <meta name="festival:city" content="Berlin &amp; Brandenburg">
    <div class="lineup-artist">Band A</div>
    <span data-artist="Band B">ignored presentation</span>
    <div class="lineup-artist">band a</div>
    <a class="button tickets" href="/tickets">Buy tickets</a>`;
  const candidate = extractHtmlFallbackCandidate(html, source, "2026-08-28T21:15:00.000Z");
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.endDate, "2027-07-03");
  assert.equal(candidate.city, "Berlin & Brandenburg");
  assert.deepEqual(candidate.lineup, ["Band A", "Band B"]);
  assert.equal(candidate.ticketsUrl, "https://festival.example/tickets");
  assert.deepEqual(candidate.warnings, []);
  assert.equal(candidate.evidence.length, 5);
});

test("HTML fallback refuses unmarked prose and unsafe ticket URLs", () => {
  const html = `<p>July 1-3, 2027 in Berlin with Band A</p><a href="http://tickets.example">Tickets</a>`;
  const candidate = extractHtmlFallbackCandidate(html, source, "2026-08-28T21:15:00.000Z");
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.warnings, ["HTML fallback did not find explicitly marked festival fields"]);
});
