ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'CLAIMED' AFTER 'PENDING';

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimToken" TEXT;

CREATE INDEX "NotificationDelivery_claimToken_idx" ON "NotificationDelivery"("claimToken");

-- PostgreSQL treats NULL values as distinct in a normal unique constraint.
-- This second index makes global preferences (festivalId IS NULL) unique too.
CREATE UNIQUE INDEX "NotificationPreference_global_key"
  ON "NotificationPreference"("userId", "eventType", "channel")
  WHERE "festivalId" IS NULL;
