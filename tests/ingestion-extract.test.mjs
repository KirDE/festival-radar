import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";

const source = { festivalSlug: "example", url: "https://example.test/", strategies: ["json_ld_event", "html_fallback"], refreshPolicy: "daily", enabled: true, editionYear: 2027 };

test("combined extraction keeps JSON-LD precedence and fills missing HTML fields", () => {
  const html = `
    <script type="application/ld+json">{"@type":"MusicEvent","startDate":"2027-06-01","performer":{"name":"JSON Band"}}</script>
    <meta property="event:start_time" content="2027-07-01">
    <meta name="festival:city" content="Berlin">
    <a href="/tickets">Tickets</a>`;
  const result = extractFestivalCandidate(html, source, "2026-08-28T21:20:00.000Z");
  assert.equal(result.startDate, "2027-06-01");
  assert.equal(result.city, "Berlin");
  assert.deepEqual(result.lineup, ["JSON Band"]);
  assert.equal(result.ticketsUrl, "https://example.test/tickets");
  assert.deepEqual(result.warnings, []);
  assert.equal(new Set(result.evidence.map(({ field }) => field)).size, result.evidence.length);
});
