import { db } from '../lib/db.ts';
import { renewPlaylistRefreshLease, spotifyCreationState } from '../lib/catalog/playlist-queue.ts';
try {
  const claim = JSON.parse(process.env.PLAYLIST_LEASE ?? 'null');
  claim.leaseExpiresAt = new Date(claim.leaseExpiresAt);
  const renewed = await renewPlaylistRefreshLease(db, claim, 120_000);
  const publication = await db.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId }, select: { createdAt: true, editionYear: true } });
  const expectedUrl = process.env.PLAYLIST_EXPECTED_URL ?? '';
  const creating = ['', 'NEW'].includes(expectedUrl);
  const action = process.argv[2] ?? 'read';
  let state;
  if (creating) {
    // Includes edition, binding and newer-publication checks inside the fence.
    state = await spotifyCreationState(db, claim, action as 'read' | 'reserve' | 'bind', expectedUrl, process.argv[3]);
  } else {
    if (action !== 'read') throw new Error('Existing playlist cannot create');
    const binding = await db.festivalPlaylist.findFirst({ where: { provider: 'spotify', url: expectedUrl, edition: { year: publication.editionYear, recordState: 'CURRENT', festival: { slug: claim.festivalSlug } } } });
    if (!binding) throw new Error('Playlist binding changed');
  }
  const newer = await db.catalogPlaylistRefresh.count({ where: {
    festivalSlug: claim.festivalSlug, status: "SUCCEEDED",
    publication: { createdAt: { gt: publication.createdAt } },
  } });
  if (newer) throw new Error("A newer playlist publication already completed; stale plan requires reconciliation");
  const [stamp] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  if (renewed.leaseExpiresAt.getTime() - stamp.now.getTime() < 60_000) throw new Error('Insufficient request lifetime');
  if (process.argv[2]) console.log(JSON.stringify(state));
} catch { process.exitCode = 1; }
finally { await db.$disconnect(); }
