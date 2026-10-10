import { pathToFileURL } from 'node:url';
import { verifiedSpotifyArtistId } from '../lib/artist-spotify-identity.ts';
import { spotifyArtistFetcher, refreshSpotifyArtistStats } from '../lib/catalog/artist-spotify-stats.ts';
import { spotifyResolution, publishSpotifyIdentity } from '../lib/catalog/spotify-identity-publication.ts';

// Separate from MusicBrainz checkpoints: an old "completed" slug must not skip
// newly introduced metrics or an identity resolved after that checkpoint.
export async function runSpotifyStats({ db, lease, fetchArtist = spotifyArtistFetcher(), now = () => new Date() }) {
  const artists = await db.artist.findMany({ include: { identities: true, links: true }, orderBy: { slug: 'asc' } });
  if (artists.length > 1000) throw new Error('Spotify artist catalog exceeds bound');
  const state = await db.operationalState.findUnique({ where: { key: 'artist-identities' } });
  const evidence = state?.payload?.artists ?? {};
  const summary = { total: artists.length, updated: 0, fresh: 0, unverified: 0, conflict: 0, unavailable: 0, linked: 0 };
  for (const artist of artists) {
    let id = verifiedSpotifyArtistId(artist);
    if (id && artist.spotifyStatsArtistId === id && artist.spotifyStatsCheckedAt
      && now().getTime() - artist.spotifyStatsCheckedAt.getTime() < 86400000) { summary.fresh++; continue; }
    const proof = !id && spotifyResolution(evidence[artist.name], artist.name);
    id ??= proof?.spotifyId;
    if (!id) { summary.unverified++; continue; }
    let observation;
    try { observation = await fetchArtist(id); } catch { summary.unavailable++; continue; }
    if (proof) {
      const result = await publishSpotifyIdentity(db, lease, artist.slug, observation);
      if (result === 'conflict' || result === 'unverified') { summary[result]++; continue; }
      if (result === 'published') summary.linked++;
    }
    const result = await refreshSpotifyArtistStats({ db, lease, slug: artist.slug, fetchArtist: async () => observation, now });
    if (result === 'updated') summary.updated++;
    else if (result === 'unavailable' || result === 'unverified') summary[result]++;
  }
  // The summary is durable and contains no credentials or raw provider errors.
  const saved = await db.$executeRaw`UPDATE "OperationalState" SET payload = jsonb_set(payload, '{spotifyStatsRun}', ${JSON.stringify({ ...summary, checkedAt: now().toISOString() })}::jsonb),
    "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE key = ${lease.key} AND "leaseOwner" = ${lease.owner}
    AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
  if (saved !== 1) throw new Error("Operational state lease lost");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let db, lease;
  try {
    ({ db } = await import('../lib/db.ts'));
    const { claimOperationalState } = await import('../lib/catalog/operational-state.ts');
    lease = await claimOperationalState(db, 'artist-enrichment');
    console.log(JSON.stringify(await runSpotifyStats({ db, lease })));
  } catch { console.error('Spotify statistics refresh failed; snapshots retained'); process.exitCode = 1; }
  finally { await lease?.release(); await db?.$disconnect(); }
}
