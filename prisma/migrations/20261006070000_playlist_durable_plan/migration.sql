-- Nullable and additive. Existing jobs remain untouched and require no backfill.
ALTER TABLE "CatalogPlaylistRefresh" ADD COLUMN "desiredPlan" JSONB;
CREATE TABLE "OperationalState" (
  "key" TEXT PRIMARY KEY,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
