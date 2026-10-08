import { createHash } from "node:crypto";

export const ACTIVATION = "UPDATE_EXISTING_ROCKHARZ_2027";
export const PUBLICATION_KEY = "guarded-update:rockharz:2027:v1";
export const REVIEWED_AT = new Date("2026-10-08T00:00:00.000Z");
// The official headliner announcement promises another wave on 9 October.
export const REVIEW_EXPIRES_AT = new Date("2026-10-09T13:45:00.000Z");
export const URLS = {
  wave: "https://www.rockharz-festival.com/erste-bandwelle-fuer-das-rockharz-2027",
  bands: "https://www.rockharz-festival.com/bands",
  headliner: "https://www.rockharz-festival.com/headliner-alarm",
  tickets: "https://ticketmarktplatz.rockharz-festival.com/",
  soldOut: "https://www.rockharz-festival.com/das-rockharz-2027-ist-ausverkauft",
} as const;

export const PLAN = {
  version: 1, operation: "UPDATE_EXISTING", slug: "rockharz", name: "Rockharz Open Air", year: 2027,
  startDate: "2027-07-07", endDate: "2027-07-10", city: "Ballenstedt",
  status: "PARTIAL", completeness: "PARTIAL", ticketStatus: "UNAVAILABLE",
  headliners: ["Amon Amarth"],
  lineup: ["Accept", "Alestorm", "All for Metal", "Arch Enemy", "Bruce Dickinson", "Coppelius",
    "Dust Bolt", "Eisbrecher", "Emil Bulls", "Equilibrium", "Gutalax", "GWAR", "Handgemeng",
    "H-Blockx", "Igel vs. Shark", "Katerfahrt", "Korpiklaani", "Lord of the Lost", "Marduk",
    "Metal Church", "Nestor", "SETYØURSAILS", "Tankard", "Storm Seeker", "The Sisters of Mercy", "Turbobier"],
  omitted: [
    { articleName: "GRAVE DIIGGER", tileTitle: "GRAVE DIGGER", reason: "Tile title verified; article typo differs. Existing canonical identity spelling requires review; never create the article typo." },
    { articleName: "DARTAGNAN", tileTitle: "DARTAGNAN", reason: "Tile title verified; article prose uses D’ARTAGNAN. Existing canonical identity and apostrophe variants require review; do not create an unsafe identity." },
    { articleName: "SKĀLD", tileTitle: "SKALD", reason: "Tile title verified; article also uses SKÀLD. Existing canonical identity and diacritic variants require review." },
  ],
  tilesVerified: { checkedAt: "2026-10-08", titledTileCount: 29, method: "Independent host read-only curl inspection of live /bands HTML titles" },
  tileSpellingDifferences: [
    { articleName: "Igel vs. Shark", tileTitle: "IGELS VS. SHARK" },
    { articleName: "SETYØURSAILS", tileTitle: "SETYOURSAILS" },
    { articleName: "Storm Seeker", tileTitle: "STORMSEEKER" },
  ],
  urls: URLS, reviewedAt: REVIEWED_AT.toISOString(), expiresAt: REVIEW_EXPIRES_AT.toISOString(),
  playlistRefreshRequested: false,
} as const;
export const PLAN_HASH = createHash("sha256").update(JSON.stringify(PLAN)).digest("hex");
export const FIELDS = ["city", "startDate", "endDate", "status", "completeness", "ticketStatus", "ticketsUrl", "lineup", "headliners"];
export const PROVENANCE = [
  { field: "lineup", url: URLS.wave, note: "26 securely verified first-wave names; three spelling cases omitted pending manual review. Partial lineup." },
  { field: "headliners", url: URLS.headliner, note: "Amon Amarth explicitly confirmed as 2027 HEADLINER; separate evidence from /bands and first wave." },
  { field: "startDate", url: URLS.tickets, note: "7–10 July 2027, Ballenstedt." },
  { field: "endDate", url: URLS.tickets, note: "7–10 July 2027, Ballenstedt." },
  { field: "city", url: URLS.tickets, note: "Ballenstedt; festival-level city field." },
  { field: "ticketStatus", url: URLS.soldOut, note: "2027 festival tickets sold out; UNAVAILABLE. Marketplace registration is not ticket availability." },
  { field: "ticketsUrl", url: URLS.tickets, note: "Official second-hand marketplace; opens early 2027." },
  { field: "status", url: URLS.wave, note: "Partial announcement; no inference of a complete lineup." },
  { field: "completeness", url: URLS.wave, note: "PARTIAL; further bands promised." },
] as const;

export function artistSlug(name: string) {
  // Keep the established catalog slug convention, including non-ASCII handling.
  return name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}
// Collision detection only. A folded match never authorizes merging/renaming.
export function artistCollisionKey(name: string) {
  const letters: Record<string, string> = { "ø": "o", "ł": "l", "æ": "ae", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ß": "ss", "ħ": "h", "ı": "i" };
  return name.normalize("NFKD").toLowerCase().replace(new RegExp("\\p{M}", "gu"), "")
    .replace(/[øłæœđðþßħı]/g, (letter) => letters[letter]).replace(new RegExp("[^\\p{L}\\p{N}]", "gu"), "");
}
export function validateNames(names: readonly string[]) {
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length
    || new Set(names.map(artistCollisionKey)).size !== names.length
    || new Set(names.map(artistSlug)).size !== names.length || names.some((n) => !artistSlug(n))) {
    throw new Error("Ambiguous reviewed artist list");
  }
}
