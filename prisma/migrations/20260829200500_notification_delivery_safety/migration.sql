-- PostgreSQL treats NULL values as distinct in a normal unique constraint.
-- This second index makes global preferences (festivalId IS NULL) unique too.
CREATE UNIQUE INDEX "NotificationPreference_global_key"
  ON "NotificationPreference"("userId", "eventType", "channel")
  WHERE "festivalId" IS NULL;
