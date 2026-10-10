import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const source = { festivalSlug: "wacken-open-air", url: "https://www.wacken.com/", strategies: ["json_ld_event", "html_fallback"], refreshPolicy: "daily", enabled: true, editionYear: 2027 };
const current = { slug: source.festivalSlug, editionYear: 2027, startDate: "2027-07-28", endDate: "2027-07-31", city: "Wacken", status: "partial", ticketStatus: "unknown", headliners: ["Existing headliner"], lineup: ["Existing support"] };
const fetchedAt = "2026-10-10T07:17:14.318Z";
// Original official candidate excerpt from the real import-agent correction.
const ticket = `<a href="/de/tickets-shop/ticket-uebersicht-2027/" id="nav-item-1009" class="nav-link dropdown-toggle" title="Tickets &amp; Shop" aria-haspopup="true" aria-expanded="false"><span class="nav-link-text">Tickets &amp; Shop</span></a>`;
const extract = (html, overrides = {}) => extractFestivalCandidate(html, { ...source, ...overrides }, fetchedAt);

test("Wacken's real ticket correction publishes through fallback without optional JSON-LD", () => {
  const candidate = extract(ticket);
  assert.equal(candidate.ticketsUrl, "https://www.wacken.com/de/tickets-shop/ticket-uebersicht-2027/");
  assert.deepEqual(candidate.warnings, []);
  assert.equal(candidate.evidence[0].excerpt, ticket);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, true);
  assert.deepEqual(result.reviewReasons, []);
  assert.deepEqual(result.changes.map(({ field }) => field), ["ticketsUrl"]);
  for (const field of ["startDate", "endDate", "headliners", "lineup", "status", "ticketStatus"]) assert.equal(candidate[field], undefined);
  // A later run against already-corrected facts is a clean unchanged parse.
  const unchanged = evaluateCandidate({ ...current, ticketsUrl: candidate.ticketsUrl }, candidate);
  assert.deepEqual(unchanged.changes, []);
  assert.deepEqual(unchanged.reviewReasons, []);
});

test("later ticket editions and announcement links are not tied to the original document", () => {
  const candidate = extract(ticket.replaceAll("2027", "2028").replace('id="nav-item-1009"', 'id="nav-item-new"'), { editionYear: 2028 });
  const result = evaluateCandidate({ ...current, editionYear: 2028 }, candidate);
  assert.equal(result.publishable, true);
  assert.equal(candidate.ticketsUrl, "https://www.wacken.com/de/tickets-shop/ticket-uebersicht-2028/");
});

test("JSON-LD-only evidence does not require HTML fallback evidence", () => {
  const candidate = extract(`<script type="application/ld+json">{"@type":"MusicEvent","startDate":"2027-07-28","offers":{"url":"https://www.wacken.com/tickets/"}}</script>`);
  assert.deepEqual(candidate.warnings, []);
  assert.equal(evaluateCandidate(current, candidate).publishable, true);
});

test("no supported evidence still records missing-format diagnostics", () => {
  const candidate = extract("<p>No festival announcement yet</p>");
  assert.deepEqual(candidate.evidence, []);
  assert.deepEqual(candidate.warnings, ["No JSON-LD Event was found", "HTML fallback did not find explicitly marked festival fields"]);
  assert.equal(evaluateCandidate(current, candidate).publishable, false);
});

test("fallback evidence never silences event cancellation or wrong-edition warnings", () => {
  for (const event of [
    { "@type": "MusicEvent", startDate: "2026-07-28" },
    { "@type": "MusicEvent", startDate: "2027-07-28", eventStatus: "https://schema.org/EventCancelled" },
    { "@type": "MusicEvent", startDate: "2027-07-28", eventStatus: "https://schema.org/EventPostponed" },
  ]) {
    const candidate = extract(`<script type="application/ld+json">${JSON.stringify(event)}</script>${ticket}`);
    assert.ok(candidate.warnings.length > 0);
    assert.equal(evaluateCandidate(current, candidate).publishable, false);
  }
});

test("fallback evidence never silences ambiguous JSON-LD events or invalid lineup", () => {
  const event = { "@type": "MusicEvent", startDate: "2027-07-28" };
  const ambiguous = extract(`<script type="application/ld+json">${JSON.stringify([event, event])}</script>${ticket}`);
  assert.match(ambiguous.warnings.join("; "), /Multiple JSON-LD Events/);
  assert.equal(evaluateCandidate(current, ambiguous).publishable, false);
  const invalid = extract(`${ticket}<div class="lineup-artist">Artists,</div>`);
  assert.ok(invalid.warnings.length > 0);
  assert.equal(evaluateCandidate(current, invalid).publishable, false);
});

test("valid ticket fallback does not bypass lineup edition or removal safeguards", () => {
  const candidate = extract(`${ticket}<span data-artist="New support">New support</span>`);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.match(result.reviewReasons.join("; "), /edition could not be verified/);
  assert.match(result.reviewReasons.join("; "), /Removals require confirmation/);
});

test("JSON-LD-only strategy still reports its own absent format", () => {
  assert.deepEqual(extract(ticket, { strategies: ["json_ld_event"] }).warnings, ["No JSON-LD Event was found"]);
});
