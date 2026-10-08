import { novaContentFixture } from "./novarock-content-fixture.ts";
import { NOVA_REVIEW_EDITION_ID, NOVA_REVIEW_SOURCE_ID, novaRockDraftBaseline, novaRockDraftRevision } from "../../lib/ingestion/novarock-review-draft.ts";

/** Synthetic identity inventory and UNVERIFIED card claims, test-only.
 * This neither captures official evidence nor supplies production bindings. */
export function novaDraftFixture() {
  const { snapshot } = novaContentFixture();
  const names = [...snapshot.candidate.normalized.headliners!, ...snapshot.candidate.normalized.lineup!];
  const stamp = new Date("2026-10-08T00:00:00Z");
  const festival = { id: "synthetic-festival", slug: "nova-rock", name: "Synthetic Nova", country: "Austria", countryCode: "AT",
    city: null, officialUrl: "https://www.novarock.at/", latitude: null, longitude: null, genres: [], catalogOrder: 0, createdAt: stamp, updatedAt: stamp };
  const edition = { id: NOVA_REVIEW_EDITION_ID, festivalId: festival.id, year: 2027, startDate: new Date("2027-06-10"), endDate: new Date("2027-06-12"),
    dateLabel: "unchanged", status: "PARTIAL" as const, ticketStatus: "UNKNOWN" as const, ticketsUrl: null, recordState: "CURRENT" as const,
    completeness: "PARTIAL" as const, sourceUpdatedAt: stamp, snapshotAt: null, createdAt: stamp, updatedAt: stamp };
  const artists = names.map((caption, i) => ({ id: `synthetic-artist-${i}`, name: caption, slug: `nonstandard-${i}`, aliases: [], origin: null,
    genres: [], biography: null, imageUrl: null, imageAlt: null, imageWidth: null, imageHeight: null, identityState: "UNRESOLVED" as const,
    topTracks: [], recentSetlists: [], freshness: {}, createdAt: stamp, updatedAt: stamp, identities: [], links: [], provenance: [] }));
  const lineup = ["Die Ärzte", "Motionless In White", "TBS"].map((n, i) => ({ id: `synthetic-entry-${i}`, editionId: edition.id,
    artistId: artists.find((a) => a.name === n)!.id, billing: i < 2 ? "HEADLINER" as const : "LINEUP" as const,
    position: i < 2 ? i : 0, status: "ANNOUNCED" as const }));
  const cards = artists.map((a, i) => ({ caption: a.name, officialUrl: `https://www.novarock.at/artist/synthetic-card-${i}/`,
    day: ["2027-06-09", "2027-06-10", "2027-06-11", "2027-06-12"][i % 4], billing: i < 4 ? "HEADLINER" : "LINEUP",
    position: i < 4 ? i : i - 4, artistId: a.id, canonicalName: a.name, slug: a.slug, aliases: a.aliases, matchedAlias: null,
    artistRevision: novaRockDraftRevision(JSON.parse(JSON.stringify(a))) }));
  const draft = { version: 1, sealId: "synthetic-seal", candidateId: "synthetic-candidate", contentDigest: "a".repeat(64),
    proposedReviewerUserId: "synthetic-admin", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    scope: "CATALOGUE_ONLY_SPOTIFY_DEFERRED", sourceId: NOVA_REVIEW_SOURCE_ID, editionId: edition.id, festivalId: festival.id,
    configurationGeneration: 1, leaseVersion: 1, baseline: novaRockDraftBaseline(festival, edition, lineup, artists.filter((a) => lineup.some((e) => e.artistId === a.id))),
    target: { startDate: "2027-06-09", endDate: "2027-06-12", status: "PARTIAL" }, cards };
  return { festival, edition, artists, lineup, draft };
}
