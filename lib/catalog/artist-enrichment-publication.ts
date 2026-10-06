import type { Prisma, PrismaClient } from "@prisma/client";
import { boundedEnrichmentEvidence, migrateEnrichmentState } from "./artist-enrichment-state.ts";

type Proof = { field: string; source: string; url: string; checkedAt: string };
type Profile = { identities: { musicbrainz: string; setlistFm?: string }; origin?: string; genres: string[];
  links: { label: string; url: string; source: string; verified: boolean }[]; provenance: Proof[] };
type ProviderArtist = { id: string; name: string; aliases?: { name: string }[]; area?: { name: string };
  "begin-area"?: { name: string }; tags?: { name: string; count?: number }[];
  relations?: { type: string; url?: { resource: string } }[] };
const invalid = () => { throw new Error("invalid_persisted_evidence"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 500): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid();
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function uuid(value: unknown) {
  string(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) invalid();
}
function parseProfile(raw: unknown): Profile {
  const p = object(raw);
  keys(p, ["identities", "origin", "genres", "links", "provenance"]);
  const identities = object(p.identities);
  keys(identities, ["musicbrainz", "setlistFm"]); uuid(identities.musicbrainz);
  if (identities.setlistFm !== undefined) uuid(identities.setlistFm);
  if (p.origin !== undefined) string(p.origin);
  array(p.genres, 5).forEach((v) => string(v));
  for (const rawLink of array(p.links, 50)) {
    const link = object(rawLink); keys(link, ["label", "url", "source", "verified"]);
    string(link.label); string(link.url, 2048);
    if (link.source !== "official" || link.verified !== true) invalid();
  }
  for (const rawProof of array(p.provenance, 10)) {
    const proof = object(rawProof); keys(proof, ["field", "source", "url", "checkedAt"]);
    string(proof.field); string(proof.url, 2048); string(proof.checkedAt);
    if (proof.source !== "musicbrainz" || !/^\d{4}-\d{2}-\d{2}$/.test(proof.checkedAt)) invalid();
  }
  return p as unknown as Profile;
}
function parseSearch(raw: unknown): { count?: number; artists: ProviderArtist[] } {
  const search = object(raw);
  if (search.count !== undefined && (!Number.isSafeInteger(search.count) || (search.count as number) < 0)) invalid();
  for (const rawArtist of array(search.artists, 100)) {
    const a = object(rawArtist); uuid(a.id); string(a.name);
    if (a.aliases !== undefined) array(a.aliases, 100).forEach((v) => string(object(v).name));
    for (const field of ["area", "begin-area"]) if (a[field] !== undefined) string(object(a[field]).name);
    if (a.tags !== undefined) for (const tag of array(a.tags, 1000)) {
      const t = object(tag); string(t.name);
      if (t.count !== undefined && (typeof t.count !== "number" || !Number.isFinite(t.count))) invalid();
    }
    if (a.relations !== undefined) for (const relation of array(a.relations, 1000)) {
      const r = object(relation); string(r.type);
      if (r.url !== undefined) string(object(r.url).resource, 2048);
    }
  }
  return search as unknown as { count?: number; artists: ProviderArtist[] };
}
function parseResult(raw: unknown) {
  const result = object(raw); keys(result, ["schemaVersion", "source", "generatedAt", "profiles", "manualReview"]);
  if (result.schemaVersion !== 1 || result.source !== "musicbrainz") invalid();
  string(result.generatedAt);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result.generatedAt) || !Number.isFinite(Date.parse(result.generatedAt))) invalid();
  const profiles = object(result.profiles);
  Object.keys(profiles).forEach((slug) => string(slug));
  const manualReview = array(result.manualReview, 1000).map((v) => {
    const row = object(v); string(row.slug); string(row.name); string(row.reason);
    return { slug: row.slug, reason: row.reason };
  });
  return { profiles, manualReview };
}
export const exactArtistName = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase("en");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nextPosition = (rows: { position: number }[]) => rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
export type EnrichmentReview = { slug: string; reason: string; field?: string };

// Recheck persisted provider evidence. Slug lookup alone never establishes identity.
export function validateEnrichmentProfile(name: string, rawProfile: unknown, rawSearch: unknown) {
  if (rawSearch === undefined || rawSearch === null) throw new Error("missing_provider_search");
  const profile = parseProfile(rawProfile);
  const search = parseSearch(rawSearch);
  if (search.count === undefined) throw new Error("unbounded_provider_search");
  if (search.count < search.artists.length) throw new Error("invalid_provider_count");
  if (search.count > search.artists.length) throw new Error("truncated_provider_search");
  const matches = search.artists.filter((artist) => [artist.name, ...(artist.aliases ?? []).map((a) => a.name)].some((n) => exactArtistName(n) === exactArtistName(name)));
  if (matches.length !== 1) throw new Error(matches.length ? "multiple_exact_matches" : "no_exact_match");
  const selected = matches[0];
  if (selected.id !== profile.identities.musicbrainz) throw new Error("provider_identity_mismatch");
  if (profile.identities.setlistFm && profile.identities.setlistFm !== selected.id) throw new Error("unsupported_setlist_identity");
  const url = `https://musicbrainz.org/artist/${selected.id}`;
  const proof = (field: string) => {
    const rows = profile.provenance.filter((row) => row.field === field && row.url === url);
    if (rows.length !== 1 || !Number.isFinite(Date.parse(rows[0].checkedAt)) || new Date(rows[0].checkedAt).toISOString().slice(0, 10) !== rows[0].checkedAt) throw new Error(`missing_${field}_provenance`);
    return rows[0];
  };
  const identityProof = proof("identity");
  if (new Set(profile.links.map((l) => l.url)).size !== profile.links.length) throw new Error("duplicate_candidate_links");
  if (profile.origin !== undefined && profile.origin !== (selected.area?.name || selected["begin-area"]?.name)) throw new Error("origin_evidence_mismatch");
  const genres = (selected.tags ?? []).filter(({ count = 0 }) => count > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 5).map(({ name: tag }) => tag);
  if (!same(profile.genres, genres)) throw new Error("genres_evidence_mismatch");
  if (profile.origin) proof("origin");
  if (profile.genres.length) proof("genres");
  for (const link of profile.links) {
    const relationType = link.label === "Official site" ? "official homepage" : link.label === "Social profile" ? "social network" : null;
    const parsed = new URL(link.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !relationType || !selected.relations?.some((r) => r.type === relationType && r.url?.resource === link.url)) throw new Error("link_evidence_mismatch");
  }
  return { profile, url, identityProof, proof };
}

// Publication owns no files and accepts no caller-supplied result. The lease row
// supplies both the durable result and its atomic publication receipt.
export async function publishArtistEnrichment(client: PrismaClient, lease: { key: string; owner: string }) {
  if (lease.key !== "artist-enrichment") throw new Error("Invalid enrichment lease key");
  return client.$transaction(async (tx) => {
    const held = await tx.$queryRaw<Array<{ payload: Prisma.JsonObject }>>`
      SELECT payload FROM "OperationalState" WHERE key = ${lease.key} AND "leaseOwner" = ${lease.owner}
      AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (held.length !== 1) throw new Error("Operational state lease lost");
    const payload = migrateEnrichmentState(held[0].payload) as Prisma.JsonObject;
    if (!payload.result) return null;
    if (Buffer.byteLength(JSON.stringify({ result: payload.result, cache: payload.cache })) > 10_000_000) throw new Error("Enrichment state exceeds publication byte bound");
    const result = parseResult(payload.result);
    if (Object.keys(result.profiles).length + result.manualReview.length > 1000) throw new Error("Enrichment result exceeds publication bound");
    // Changing or removing evidence must invalidate a previous receipt too.
    const resultHash = boundedEnrichmentEvidence({ result: payload.result, cache: payload.cache ?? {}, legacyImport: payload.legacyImport ?? null });
    const prior = payload.publication as Prisma.JsonObject | undefined;
    if (prior?.resultHash === resultHash && prior?.policyVersion === 2) return { ...prior, changed: 0, repeated: true };
    const reviews: EnrichmentReview[] = result.manualReview.map(({ slug, reason }) => ({ slug, reason }));
    const legacy = payload.legacyImport as Prisma.JsonObject | undefined;
    if (legacy) {
      const imported = parseResult(legacy.evidence);
      for (const slug of Object.keys(imported.profiles)) {
        if (!Object.hasOwn(result.profiles, slug)) reviews.push({ slug, reason: "imported_profile_not_in_result" });
      }
    }
    const manualSlugs = new Set(reviews.map(({ slug }) => slug));
    const artists = await tx.artist.findMany({ take: 10_001, select: { id: true, slug: true, name: true, aliases: true } });
    if (artists.length > 10_000) throw new Error("Canonical artist inventory exceeds publication bound");
    let changed = 0;
    const applied: Array<{ slug: string; fields: string[] }> = [];
    for (const [slug, rawProfile] of Object.entries(result.profiles)) {
      const review = (reason: string, field?: string) => reviews.push({ slug, reason, ...(field ? { field } : {}) });
      const artist = await tx.artist.findUnique({ where: { slug }, include: { identities: true, provenance: true, links: true } });
      if (!artist) { review("unknown_canonical_artist"); continue; }
      if (manualSlugs.has(slug)) { review("manual_review_required"); continue; }
      if (artist.identityState === "AMBIGUOUS") { review("ambiguous_identity"); continue; }
      const canonical = artists.filter((a) => [a.name, ...a.aliases].some((n) => exactArtistName(n) === exactArtistName(artist.name)));
      if (canonical.length !== 1) { review("multiple_canonical_matches"); continue; }
      let verified;
      try { verified = validateEnrichmentProfile(artist.name, rawProfile, (payload.cache as Prisma.JsonObject | undefined)?.[slug]); }
      catch (error) { review((error as Error).message); continue; }
      const { profile, proof, url, identityProof } = verified;
      if (profile.provenance.some((p) => p.checkedAt > String((payload.result as Prisma.JsonObject).generatedAt).slice(0, 10))) { review("future_provenance"); continue; }
      const id = profile.identities.musicbrainz;
      const identity = artist.identities.find((i) => i.provider === "musicbrainz");
      const owner = await tx.artistIdentity.findUnique({ where: { provider_externalId: { provider: "musicbrainz", externalId: id } } });
      if ((identity && identity.externalId !== id) || (owner && owner.artistId !== artist.id)) { review("identity_conflict"); continue; }
      const state = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind: "ARTIST", resourceKey: slug } } });
      const decisions = await tx.adminChange.findMany({ where: { resourceKind: "ARTIST", resourceKey: slug, status: { in: ["PENDING", "APPROVED", "CONFLICT"] } }, select: { field: true } });
      const protectedFields = new Set([...Object.keys((state?.values as object) ?? {}), ...decisions.map((d) => d.field)]);
      const protectedField = (field: string) => protectedFields.has(field) || artist.provenance.some((p) => p.field === field);
      const fields: string[] = [];
      const addProof = async (field: string, source = proof(field)) => {
        await tx.artistProvenance.create({ data: { artistId: artist.id, field, source: "musicbrainz", url, checkedAt: new Date(source.checkedAt), position: nextPosition(artist.provenance) + fields.length } });
        fields.push(field);
      };
      if (!identity) {
        if (protectedField("identity") || protectedFields.has("identities") || protectedField("identityState") || artist.identityState === "LINKED") { review("protected_field", "identity"); continue; }
        await tx.artistIdentity.create({ data: { artistId: artist.id, provider: "musicbrainz", externalId: id, position: nextPosition(artist.identities) } });
        await addProof("identity", identityProof);
      }
      for (const field of ["origin", "genres"] as const) {
        const value = profile[field];
        if (!value || (Array.isArray(value) && !value.length) || same(artist[field], value)) continue;
        const empty = field === "origin" ? artist.origin === null : artist.genres.length === 0;
        if (!empty || protectedField(field)) { review("protected_field", field); continue; }
        await tx.artist.update({ where: { id: artist.id }, data: { [field]: value } });
        await addProof(field);
      }
      // Provider relations are evidence of a URL, not a manual verification.
      for (const link of profile.links) {
        if (artist.links.some((l) => l.url === link.url)) continue;
        if (protectedField("links")) { review("protected_field", "links"); break; }
        await tx.artistLink.create({ data: { artistId: artist.id, label: link.label, url: link.url, source: "musicbrainz", verified: false, position: nextPosition(artist.links) + fields.filter((f) => f === "links").length } });
        await addProof("links", identityProof);
      }
      if (fields.length) { changed += fields.length; applied.push({ slug, fields }); }
    }
    const publication = { policyVersion: 2, resultHash, changed, applied, reviews, publishedAt: new Date().toISOString() };
    // Retain review evidence after the next provider run replaces its result.
    // Artist approval in the generic admin store does not publish canonical
    // artist rows, so these candidates must not masquerade as approvable changes.
    await tx.adminAuditEntry.create({ data: {
      actorLabel: "automatic-artist-enrichment", action: "ARTIST_ENRICHMENT_PUBLICATION", resourceKind: "ARTIST",
      evidence: { result: payload.result, ...(legacy ? { legacyImport: legacy } : {}), reviewSearches: Object.fromEntries([...new Set(reviews.map((r) => r.slug))].map((slug) => [slug, (payload.cache as Prisma.JsonObject | undefined)?.[slug] ?? null])) } as Prisma.InputJsonValue,
      metadata: publication,
    } });
    const count = await tx.$executeRaw`UPDATE "OperationalState" SET payload = ${JSON.stringify({ ...payload, publication })}::jsonb,
      "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE key = ${lease.key} AND "leaseOwner" = ${lease.owner}
      AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
    if (count !== 1) throw new Error("Operational state lease lost");
    return publication;
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
