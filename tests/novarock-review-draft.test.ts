import assert from "node:assert/strict";
import test from "node:test";
import { novaDraftFixture } from "./support/novarock-review-draft-fixture.ts";
import { parseNovaRockReviewDraft, novaRockDraftRevision } from "../lib/ingestion/novarock-review-draft.ts";

test("44 synthetic distinct identities form a draft only, never independent evidence", () => {
  const { draft } = novaDraftFixture();
  const parsed = parseNovaRockReviewDraft(draft);
  assert.equal(parsed.cards.length, 44);
  assert.equal(parsed.scope, "CATALOGUE_ONLY_SPOTIFY_DEFERRED");
  assert.equal("approved" in parsed, false);
  assert.equal(novaRockDraftRevision(parsed), novaRockDraftRevision(structuredClone(parsed)));
});
const mutations: [string, (d: any) => void][] = [
  ["43 cards", (d) => d.cards.pop()], ["45 cards", (d) => d.cards.push(d.cards[43])],
  ["reused artist ID", (d) => d.cards[43].artistId = d.cards[42].artistId],
  ["reused official URL", (d) => d.cards[43].officialUrl = d.cards[42].officialUrl],
  ["wrong billing", (d) => d.cards[43].billing = "HEADLINER"],
  ["wrong position", (d) => d.cards[43].position = 0],
  ["undeclared alias", (d) => d.cards[43].canonicalName = "different"],
  ["ambiguous alias spelling", (d) => d.cards[43].aliases = [d.cards[43].canonicalName.toUpperCase()]],
  ["unofficial URL", (d) => d.cards[43].officialUrl = "https://evil.example/artist/a/"],
  ["wrong date", (d) => d.target.startDate = "2027-06-10"],
  ["unknown evidence flag", (d) => d.cards[43].independentlyVerified = true],
  ["arbitrary reviewer text", (d) => d.reviewer = "approved by me"],
  ["wrong scope", (d) => d.scope = "SPOTIFY"],
  ["wrong source ID", (d) => d.sourceId = "new-source"],
  ["wrong edition ID", (d) => d.editionId = "new-edition"],
  ["duplicate baseline", (d) => d.baseline.lineup[2].id = d.baseline.lineup[1].id],
  ["sparse cards", (d) => delete d.cards[43]],
];
for (const [label, mutate] of mutations) test(`draft rejects ${label}`, () => {
  const { draft } = novaDraftFixture(); mutate(draft); assert.throws(() => parseNovaRockReviewDraft(draft));
});
test("card and alias changes affect the draft digest", () => {
  const { draft } = novaDraftFixture();
  const before = novaRockDraftRevision(draft);
  draft.cards[43].day = "2027-06-09";
  assert.notEqual(novaRockDraftRevision(draft), before);
});
