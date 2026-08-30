import assert from "node:assert/strict";
import test from "node:test";
import { calendarFile, calendarUrls } from "../lib/planning.ts";

const festival = {
  slug: "test-fest", name: "Test, Rock; Fest", country: "Germany", countryCode: "DE",
  city: "Köln", startDate: "2027-06-04", endDate: "2027-06-06", headliners: [], lineup: [],
  officialUrl: "https://example.com/fest", status: "confirmed", editionYear: 2027,
};

test("calendar export uses an exclusive end date and escaped text", () => {
  const payload = calendarFile([festival]);
  assert.match(payload, /DTSTART;VALUE=DATE:20270604/);
  assert.match(payload, /DTEND;VALUE=DATE:20270607/);
  assert.match(payload, /SUMMARY:Test\\, Rock\\; Fest/);
  assert.match(payload, /LOCATION:Köln\\, Germany/);
  assert.match(payload, /UID:test-fest-2027@festival-radar/);
});

test("calendar links provide distinct explicit Google, ICS and Apple flows", () => {
  const links = calendarUrls(festival);
  assert.ok(links);
  assert.match(links.google, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(links.ics, /^data:text\/calendar;charset=utf-8,/);
  assert.match(links.apple, /^data:text\/calendar;charset=utf-8,/);
  assert.equal(decodeURIComponent(links.apple.split(",", 2)[1]), calendarFile([festival]));
});

test("undated festivals do not expose invalid calendar actions", () => {
  assert.equal(calendarUrls({ ...festival, startDate: undefined, endDate: undefined }), null);
});
