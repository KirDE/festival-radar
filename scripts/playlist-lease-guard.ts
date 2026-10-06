import { db } from '../lib/db.ts';
import { renewPlaylistRefreshLease } from '../lib/catalog/playlist-queue.ts';
try {
  const claim = JSON.parse(process.env.PLAYLIST_LEASE ?? 'null');
  claim.leaseExpiresAt = new Date(claim.leaseExpiresAt);
  const renewed = await renewPlaylistRefreshLease(db, claim, 120_000);
  const publication = await db.catalogPublication.findUniqueOrThrow({ where: { id: claim.publicationId }, select: { createdAt: true, editionYear: true } });
  const binding = await db.festivalPlaylist.findFirst({ where: { provider: "spotify", url: process.env.PLAYLIST_EXPECTED_URL ?? "", edition: { year: publication.editionYear, recordState: "CURRENT", festival: { slug: claim.festivalSlug } } } });
  if (!binding) throw new Error("Playlist binding changed");
  const newer = await db.catalogPlaylistRefresh.count({ where: {
    festivalSlug: claim.festivalSlug, status: "SUCCEEDED",
    publication: { createdAt: { gt: publication.createdAt } },
  } });
  if (newer) throw new Error("A newer playlist publication already completed; stale plan requires reconciliation");
  const [stamp] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
  if (renewed.leaseExpiresAt.getTime() - stamp.now.getTime() < 60_000) throw new Error('Insufficient request lifetime');
} catch { process.exitCode = 1; }
finally { await db.$disconnect(); }
