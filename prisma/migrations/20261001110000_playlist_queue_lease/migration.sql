-- Additive, dormant lease metadata for an opt-in DB playlist worker.
ALTER TABLE "CatalogPlaylistRefresh"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "retryAt" TIMESTAMP(3);

CREATE INDEX "CatalogPlaylistRefresh_status_leaseExpiresAt_requestedAt_idx"
  ON "CatalogPlaylistRefresh"("status", "leaseExpiresAt", "requestedAt");

CREATE INDEX "CatalogPlaylistRefresh_status_retryAt_requestedAt_idx"
  ON "CatalogPlaylistRefresh"("status", "retryAt", "requestedAt");
