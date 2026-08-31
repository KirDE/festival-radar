ALTER TYPE "NotificationStatus" ADD VALUE 'CLAIMED';

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "claimToken" TEXT;

CREATE INDEX "NotificationDelivery_claimToken_idx" ON "NotificationDelivery"("claimToken");
