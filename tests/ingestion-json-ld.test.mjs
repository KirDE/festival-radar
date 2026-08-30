import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJsonLdCandidate } from "../lib/ingestion/adapters/json-ld.ts";

const source = {
  festivalSlug: "example-fest",
  url: "https://festival.example/",
  strategies: ["json_ld_event"],
  refreshPolicy: "daily",
  enabled: true,
  editionYear: 2027,
};

test("JSON-LD extraction normalizes dates, city, performers, and tickets", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "MusicEvent",
        "startDate": "2027-07-01T16:00:00+02:00",
        "endDate": "2027-07-03",
        "location": {"@type": "Place", "address": {"addressLocality": "Berlin"}},
        "performer": [{"@type": "MusicGroup", "name": "Band A"}, {"name": "Band B"}],
        "offers": {"@type": "Offer", "url": "https://tickets.example/fest", "availability": "https://schema.org/LimitedAvailability"},
        "subEvent": [{"@type": "MusicEvent", "name": "Band A", "startDate": "2027-07-01T18:30:00Z", "location": {"name": "Main Stage"}}]
      }
    </script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.equal(candidate.startDate, "2027-07-01");
  assert.equal(candidate.endDate, "2027-07-03");
  assert.equal(candidate.city, "Berlin");
  assert.deepEqual(candidate.lineup, ["Band A", "Band B"]);
  assert.equal(candidate.ticketsUrl, "https://tickets.example/fest");
  assert.equal(candidate.ticketStatus, "low");
  assert.deepEqual(candidate.timetable, [{ date: "2027-07-01", start: "18:30", stage: "Main Stage", artist: "Band A" }]);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(new Set(candidate.evidence.map(({ field }) => field)), new Set(["startDate", "endDate", "city", "lineup", "ticketsUrl", "ticketStatus", "timetable"]));
});

test("JSON-LD extraction supports @graph and routes risky statuses to review", () => {
  const html = `<script type='application/ld+json'>${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Promoter" },
      { "@type": ["Event", "MusicEvent"], startDate: "2027-08-05", eventStatus: "https://schema.org/EventCancelled" },
    ],
  })}</script>`;
  const candidate = extractJsonLdCandidate(html, source, "2026-08-28T21:00:00.000Z");
  assert.equal(candidate.startDate, "2027-08-05");
  assert.ok(candidate.warnings.some((warning) => warning.includes("EventCancelled")));
});

test("missing or malformed JSON-LD returns a reviewable candidate", () => {
  const malformed = extractJsonLdCandidate('<script type="application/ld+json">{broken}</script>', source, "2026-08-28T21:00:00.000Z");
  assert.deepEqual(malformed.evidence, []);
  assert.deepEqual(malformed.warnings, ["No JSON-LD Event was found"]);
});
