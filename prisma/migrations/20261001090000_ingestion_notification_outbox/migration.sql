CREATE TABLE "IngestionNotificationOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "publicationId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "event" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "IngestionNotificationOutbox_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IngestionNotificationOutbox_publicationId_dedupeKey_key" ON "IngestionNotificationOutbox"("publicationId", "dedupeKey");
CREATE INDEX "IngestionNotificationOutbox_deliveredAt_createdAt_idx" ON "IngestionNotificationOutbox"("deliveredAt", "createdAt");
