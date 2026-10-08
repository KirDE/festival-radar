-- Nullable observations: absence is unknown, never an invented zero.
ALTER TABLE "Artist"
  ADD COLUMN "spotifyPopularity" INTEGER,
  ADD COLUMN "spotifyFollowers" BIGINT,
  ADD COLUMN "spotifyStatsCheckedAt" TIMESTAMP(3),
  ADD COLUMN "spotifyStatsArtistId" TEXT,
  ADD COLUMN "spotifyStatsSourceUrl" TEXT,
  ADD CONSTRAINT "Artist_spotifyPopularity_range" CHECK ("spotifyPopularity" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Artist_spotifyFollowers_range" CHECK ("spotifyFollowers" BETWEEN 0 AND 9007199254740991);
