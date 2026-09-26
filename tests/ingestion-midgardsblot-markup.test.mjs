import assert from "node:assert/strict";
import { test } from "node:test";
import { getFestivalSource } from "../data/festival-sources.ts";
import { festivals } from "../data/festivals.ts";
import { extractFestivalCandidate } from "../lib/ingestion/extract.ts";
import { evaluateCandidate } from "../lib/ingestion/policy.ts";

const officialBundle = `
  children:"18.-21. August 2027 | Borre Norway",
  {id:"arthur-brown",name:"Arthur Brown",info:"Midgardsblot 2026"},
  {id:"saxon",name:"Saxon",info:"Saturday's headliner at Midgardsblot 2026"}`;

test("Midgardsblot extracts only the official 2027 date and location", () => {
  const source = getFestivalSource("midgardsblot");
  assert.deepEqual(source?.strategies, ["official_markup"]);
  assert.equal(source?.refreshPolicy, "daily");
  assert.equal(source?.followLinkPattern, "^/assets/index-[A-Za-z0-9_-]+\\.js$");
  const candidate = extractFestivalCandidate(officialBundle, source, "2026-09-26T15:30:00Z");
  assert.equal(candidate.startDate, "2027-08-18");
  assert.equal(candidate.endDate, "2027-08-21");
  assert.equal(candidate.city, "Borre");
  assert.deepEqual(candidate.observedEditionYears, [2027]);
  assert.equal(candidate.headliners, undefined);
  assert.equal(candidate.lineup, undefined, "the still-labelled 2026 lineup must not leak into 2027");
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.evidence.map(({ field }) => field), ["startDate", "endDate", "city"]);
});

test("Midgardsblot fails closed when the edition marker changes", () => {
  const source = getFestivalSource("midgardsblot");
  const candidate = extractFestivalCandidate(officialBundle.replace("2027 | Borre", "2026 | Borre"), source, "2026-09-26T15:30:00Z");
  const current = festivals.find(({ slug }) => slug === "midgardsblot");
  assert.ok(current);
  assert.deepEqual(candidate.observedEditionYears, [2026]);
  const result = evaluateCandidate(current, candidate);
  assert.equal(result.publishable, false);
  assert.match(result.reviewReasons.join("\n"), /Candidate edition 2026 does not match catalogue edition 2027/);
});
