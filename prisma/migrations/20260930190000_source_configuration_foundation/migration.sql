-- Additive only; do not seed configuration in a recurring catalogue migration.
ALTER TABLE "FestivalSource"
  ADD COLUMN "editionId" TEXT,
  ADD COLUMN "parserKey" TEXT,
  ADD COLUMN "fetchUrl" TEXT,
  ADD COLUMN "followLinkPattern" TEXT,
  ADD COLUMN "requestHeaders" JSONB,
  ADD COLUMN "cadenceSeconds" INTEGER,
  ADD COLUMN "nextRunAt" TIMESTAMP(3),
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "httpEtag" TEXT,
  ADD COLUMN "httpLastModified" TEXT,
  ADD COLUMN "configurationBackfilledAt" TIMESTAMP(3);
ALTER TABLE "FestivalSource" ADD CONSTRAINT "FestivalSource_editionId_fkey"
  FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "FestivalSource_enabled_nextRunAt_idx" ON "FestivalSource"("enabled", "nextRunAt");
CREATE INDEX "FestivalSource_leaseExpiresAt_idx" ON "FestivalSource"("leaseExpiresAt");
CREATE INDEX "FestivalSource_editionId_idx" ON "FestivalSource"("editionId");
ALTER TABLE "FestivalSource" ADD CONSTRAINT "FestivalSource_cadenceSeconds_check"
  CHECK ("cadenceSeconds" IS NULL OR "cadenceSeconds" > 0);
ALTER TABLE "FestivalSource" ADD CONSTRAINT "FestivalSource_consecutiveFailures_check"
  CHECK ("consecutiveFailures" >= 0);
