import type { PrismaClient } from "@prisma/client";

const normalized = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
// A search result alone never establishes identity. Require the resolver's single
// cross-provider relation, exact names and a fresh Spotify artist observation.
export function spotifyResolution(evidence: any, name: string, observed?: any) {
  if (evidence?.status !== "linked" || evidence.linked?.length !== 1 || normalized(evidence.name) !== normalized(name)) return null;
  const { spotify, musicBrainz } = evidence.linked[0];
  if (!spotify || !musicBrainz || !/^[A-Za-z0-9]{22}$/.test(spotify.id ?? "")
    || !/^[a-f0-9-]{36}$/i.test(musicBrainz.id ?? "")
    || normalized(spotify.name) !== normalized(name) || normalized(musicBrainz.name) !== normalized(name)
    || spotify.url !== `https://open.spotify.com/artist/${spotify.id}`
    || musicBrainz.url !== `https://musicbrainz.org/artist/${musicBrainz.id}`
    || !musicBrainz.spotifyUrls?.includes(spotify.url)) return null;
  if (observed && (observed.id !== spotify.id || observed.type !== "artist" || normalized(observed.name) !== normalized(name))) return null;
  return { spotifyId: spotify.id as string, musicBrainzId: musicBrainz.id as string, url: spotify.url as string, sourceUrl: musicBrainz.url as string };
}

export async function publishSpotifyIdentity(db: PrismaClient, lease: { key: string; owner: string }, slug: string, observed: unknown) {
  if (lease.key !== "artist-enrichment") throw new Error("Invalid enrichment lease key");
  return db.$transaction(async tx => {
    const held = await tx.$queryRaw<{ key: string }[]>`SELECT key FROM "OperationalState" WHERE key = ${lease.key}
      AND "leaseOwner" = ${lease.owner} AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (held.length !== 1) throw new Error("Operational state lease lost");
    const state = await tx.operationalState.findUnique({ where: { key: "artist-identities" } });
    const artist = await tx.artist.findUnique({ where: { slug }, include: { identities: true, links: true } });
    if (!artist || artist.identityState === "AMBIGUOUS") return "unverified";
    const evidence = (state?.payload as any)?.artists?.[artist.name];
    const proof = spotifyResolution(evidence, artist.name, observed);
    if (!proof) return "unverified";
    const existing = artist.identities.find(i => i.provider === "spotify");
    const mb = artist.identities.find(i => i.provider === "musicbrainz");
    if ((existing && existing.externalId !== proof.spotifyId) || (mb && mb.externalId !== proof.musicBrainzId)
      || artist.links.some(l => l.source === "spotify" && l.verified && l.url !== proof.url)) return "conflict";
    if (existing && artist.identityState === "LINKED" && artist.links.some(l => l.source === "spotify" && l.verified && l.url === proof.url)) return "unchanged";
    const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind: "ARTIST", resourceKey: slug } } });
    const decisions = await tx.adminChange.findMany({ where: { resourceKind: "ARTIST", resourceKey: slug, status: { in: ["PENDING", "APPROVED", "CONFLICT"] } }, select: { field: true } });
    const fields = new Set([...Object.keys((resource?.values as object) ?? {}), ...decisions.map(d => d.field)]);
    if (["identity", "identities", "identityState", "links"].some(f => fields.has(f))) return "conflict";
    const owner = await tx.artistIdentity.findUnique({ where: { provider_externalId: { provider: "spotify", externalId: proof.spotifyId } } });
    if (owner && owner.artistId !== artist.id) return "conflict";
    if (!existing) await tx.artistIdentity.create({ data: { artistId: artist.id, provider: "spotify", externalId: proof.spotifyId, position: artist.identities.length } });
    await tx.artistLink.upsert({ where: { artistId_url: { artistId: artist.id, url: proof.url } },
      create: { artistId: artist.id, label: "Spotify", source: "spotify", url: proof.url, verified: true, position: artist.links.length }, update: { source: "spotify", verified: true } });
    await tx.artist.update({ where: { id: artist.id }, data: { identityState: "LINKED" } });
    await tx.artistProvenance.create({ data: { artistId: artist.id, field: "spotifyIdentity", source: "musicbrainz", url: proof.sourceUrl, checkedAt: new Date() } });
    await tx.adminAuditEntry.create({ data: { actorLabel: "automatic-spotify-identity", action: "ARTIST_SPOTIFY_IDENTITY_PUBLICATION", resourceKind: "ARTIST", resourceKey: slug,
      detail: { spotifyArtistId: proof.spotifyId, musicBrainzId: proof.musicBrainzId, sourceUrl: proof.sourceUrl } } });
    const valid = await tx.$queryRaw<{ key: string }[]>`SELECT key FROM "OperationalState" WHERE key = ${lease.key}
      AND "leaseOwner" = ${lease.owner} AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
    if (valid.length !== 1) throw new Error("Operational state lease lost");
    return "published";
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
