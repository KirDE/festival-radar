CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'WEB_PUSH');
CREATE TYPE "NotificationFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY');
CREATE TYPE "NotificationEventType" AS ENUM ('ARTIST_ADDED', 'ARTIST_CANCELLED', 'FESTIVAL_DATE_MOVED', 'TICKETS_ON_SALE', 'TICKETS_LOW', 'TICKETS_SOLD_OUT', 'TIMETABLE_PUBLISHED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "festivalId" TEXT,
  "eventType" "NotificationEventType" NOT NULL, "channel" "NotificationChannel" NOT NULL,
  "frequency" "NotificationFrequency" NOT NULL DEFAULT 'IMMEDIATE', "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationSubscription" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "channel" "NotificationChannel" NOT NULL,
  "endpoint" TEXT NOT NULL, "metadata" JSONB, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationSubscription_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "festivalId" TEXT NOT NULL,
  "type" "NotificationEventType" NOT NULL, "title" TEXT NOT NULL, "message" TEXT NOT NULL,
  "url" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL, "frequency" "NotificationFrequency" NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_festivalId_eventType_channel_key" ON "NotificationPreference"("userId", "festivalId", "eventType", "channel");
CREATE INDEX "NotificationPreference_festivalId_eventType_enabled_idx" ON "NotificationPreference"("festivalId", "eventType", "enabled");
CREATE UNIQUE INDEX "NotificationSubscription_userId_channel_endpoint_key" ON "NotificationSubscription"("userId", "channel", "endpoint");
CREATE INDEX "NotificationSubscription_userId_channel_enabled_idx" ON "NotificationSubscription"("userId", "channel", "enabled");
CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key" ON "NotificationEvent"("dedupeKey");
CREATE INDEX "NotificationEvent_festivalId_type_occurredAt_idx" ON "NotificationEvent"("festivalId", "type", "occurredAt");
CREATE UNIQUE INDEX "NotificationDelivery_eventId_userId_channel_key" ON "NotificationDelivery"("eventId", "userId", "channel");
CREATE INDEX "NotificationDelivery_status_frequency_nextAttemptAt_idx" ON "NotificationDelivery"("status", "frequency", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationSubscription" ADD CONSTRAINT "NotificationSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
