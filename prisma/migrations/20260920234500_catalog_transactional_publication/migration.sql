CREATE TYPE "CatalogPublicationSource" AS ENUM ('INGESTION', 'ADMIN');
CREATE TYPE "CatalogPlaylistRefreshStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "CatalogPublication" (
  "id" TEXT NOT NULL,
  "source" "CatalogPublicationSource" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "festivalSlug" TEXT NOT NULL,
  "editionYear" INTEGER NOT NULL,
  "actorLabel" TEXT NOT NULL,
  "fields" TEXT[] NOT NULL,
  "lineupChanged" BOOLEAN NOT NULL DEFAULT false,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogPublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogPlaylistRefresh" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "festivalSlug" TEXT NOT NULL,
  "status" "CatalogPlaylistRefreshStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogPlaylistRefresh_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogPublication_sourceId_key" ON "CatalogPublication"("sourceId");
CREATE INDEX "CatalogPublication_festivalSlug_createdAt_idx" ON "CatalogPublication"("festivalSlug", "createdAt");
CREATE INDEX "CatalogPublication_source_createdAt_idx" ON "CatalogPublication"("source", "createdAt");
CREATE UNIQUE INDEX "CatalogPlaylistRefresh_publicationId_key" ON "CatalogPlaylistRefresh"("publicationId");
CREATE INDEX "CatalogPlaylistRefresh_status_requestedAt_idx" ON "CatalogPlaylistRefresh"("status", "requestedAt");
CREATE INDEX "CatalogPlaylistRefresh_festivalSlug_status_idx" ON "CatalogPlaylistRefresh"("festivalSlug", "status");

ALTER TABLE "CatalogPlaylistRefresh" ADD CONSTRAINT "CatalogPlaylistRefresh_publicationId_fkey"
  FOREIGN KEY ("publicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_catalog_publication_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CatalogPublication is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CatalogPublication_immutable_update" BEFORE UPDATE ON "CatalogPublication"
  FOR EACH ROW EXECUTE FUNCTION reject_catalog_publication_mutation();
CREATE TRIGGER "CatalogPublication_immutable_delete" BEFORE DELETE ON "CatalogPublication"
  FOR EACH ROW EXECUTE FUNCTION reject_catalog_publication_mutation();
