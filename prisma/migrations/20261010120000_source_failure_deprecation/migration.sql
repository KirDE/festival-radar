ALTER TABLE "FestivalSource" ADD COLUMN "failureStartedAt" TIMESTAMP(3), ADD COLUMN "deprecatedAt" TIMESTAMP(3);
-- Use observed failures after the last known successful check, never catalogue
-- content age: unchanged successful HTTP checks are healthy.
UPDATE "FestivalSource" s SET "failureStartedAt" = COALESCE(
  (SELECT MIN(a."endedAt") FROM "IngestionAttempt" a WHERE a."festivalSlug"=s."festivalSlug" AND a."requestedUrl"=s.url
    AND a.status='FAILED' AND a."endedAt" >= COALESCE(s."lastSuccessAt", s."configurationBackfilledAt", s."createdAt")), s."lastAttemptAt")
WHERE s."consecutiveFailures" > 0;
-- Existing repeated failures also adopt the requested ladder, without an extra
-- model/browser retry or advancing the observation timestamp.
UPDATE "FestivalSource" SET "nextRunAt" = "lastAttemptAt" + make_interval(secs =>
  CASE "consecutiveFailures" WHEN 1 THEN 3600 WHEN 2 THEN 21600 WHEN 3 THEN 86400 WHEN 4 THEN 259200 ELSE 604800 END)
WHERE "consecutiveFailures" > 0 AND "lastAttemptAt" IS NOT NULL
  AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC'));
