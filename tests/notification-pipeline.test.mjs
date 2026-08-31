import assert from "node:assert/strict";
import test from "node:test";
import { notificationEventsForChanges } from "../lib/ingestion/notification-events.ts";
import { nextDigest } from "../lib/notification-schedule.ts";

const festival = { slug: "test-fest", name: "Test Fest", country: "Germany", countryCode: "DE", officialUrl: "https://example.test", headliners: [], lineup: [], status: "confirmed", editionYear: 2027 };

test("publication maps every supported event type to stable edition-aware keys", () => {
  const changes = [
    { kind: "artist_added", field: "lineup", after: "New Band", reviewRequired: false },
    { kind: "artist_removed", field: "lineup", before: "Gone Band", reviewRequired: true },
    { kind: "date_changed", field: "startDate", before: "2027-01-01", after: "2027-01-02", reviewRequired: false },
    { kind: "ticket_status_changed", field: "ticketStatus", before: "unknown", after: "available", reviewRequired: false },
    { kind: "ticket_status_changed", field: "ticketStatus", before: "available", after: "low", reviewRequired: false },
    { kind: "ticket_status_changed", field: "ticketStatus", before: "low", after: "unavailable", reviewRequired: false },
    { kind: "timetable_published", field: "timetable", after: "42", reviewRequired: false },
  ];
  const first = notificationEventsForChanges(festival, changes, "2026-08-29T19:15:00.000Z");
  const second = notificationEventsForChanges(festival, changes, "2026-08-29T19:16:00.000Z");
  assert.deepEqual(new Set(first.map(({ type }) => type)), new Set(["ARTIST_ADDED", "ARTIST_CANCELLED", "FESTIVAL_DATE_MOVED", "TICKETS_ON_SALE", "TICKETS_LOW", "TICKETS_SOLD_OUT", "TIMETABLE_PUBLISHED"]));
  assert.deepEqual(first.map(({ dedupeKey }) => dedupeKey), second.map(({ dedupeKey }) => dedupeKey));
  assert.ok(first.every(({ dedupeKey, festivalId }) => dedupeKey.includes(":2027:") && festivalId === "test-fest:2027"));
});

test("digest schedule is daily 08:00 UTC and weekly Monday 08:00 UTC", () => {
  assert.equal(nextDigest("DAILY", new Date("2026-08-29T07:00:00Z")).toISOString(), "2026-08-29T08:00:00.000Z");
  assert.equal(nextDigest("DAILY", new Date("2026-08-29T09:00:00Z")).toISOString(), "2026-08-30T08:00:00.000Z");
  assert.equal(nextDigest("WEEKLY", new Date("2026-08-29T09:00:00Z")).toISOString(), "2026-08-31T08:00:00.000Z");
  assert.equal(nextDigest("WEEKLY", new Date("2026-08-31T09:00:00Z")).toISOString(), "2026-09-07T08:00:00.000Z");
});
