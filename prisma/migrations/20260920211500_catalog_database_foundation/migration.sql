-- CreateEnum
CREATE TYPE "FestivalStatus" AS ENUM ('CONFIRMED', 'PARTIAL', 'TBA');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('AVAILABLE', 'LOW', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EditionRecordState" AS ENUM ('ARCHIVED', 'CURRENT', 'TRACKING');

-- CreateEnum
CREATE TYPE "EditionCompleteness" AS ENUM ('COMPLETE', 'PARTIAL', 'TBA');

-- CreateEnum
CREATE TYPE "LineupBilling" AS ENUM ('HEADLINER', 'LINEUP');

-- CreateEnum
CREATE TYPE "LineupEntryStatus" AS ENUM ('ANNOUNCED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ArtistIdentityState" AS ENUM ('LINKED', 'AMBIGUOUS', 'UNRESOLVED', 'RETRYABLE');

-- CreateTable
CREATE TABLE "Festival" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "city" TEXT,
    "officialUrl" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "genres" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Festival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FestivalEdition" (
    "id" TEXT NOT NULL,
    "festivalId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "dateLabel" TEXT,
    "status" "FestivalStatus" NOT NULL,
    "ticketStatus" "TicketStatus" NOT NULL,
    "ticketsUrl" TEXT,
    "recordState" "EditionRecordState" NOT NULL,
    "completeness" "EditionCompleteness" NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "snapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FestivalEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "origin" TEXT,
    "genres" TEXT[],
    "biography" TEXT,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "identityState" "ArtistIdentityState" NOT NULL,
    "topTracks" TEXT[],
    "recentSetlists" JSONB NOT NULL,
    "freshness" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistIdentity" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "ArtistIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistLink" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ArtistLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistProvenance" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineupEntry" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "billing" "LineupBilling" NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "LineupEntryStatus" NOT NULL DEFAULT 'ANNOUNCED',

    CONSTRAINT "LineupEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditionProvenance" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "EditionProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetablePerformance" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "artistId" TEXT,
    "artistName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "stage" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "timeZone" TEXT,
    "status" "LineupEntryStatus" NOT NULL DEFAULT 'ANNOUNCED',
    "sourceUrl" TEXT,
    "observedAt" TIMESTAMP(3),

    CONSTRAINT "TimetablePerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FestivalPlaylist" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "artistCount" INTEGER,
    "trackCount" INTEGER,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "FestivalPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FestivalSource" (
    "id" TEXT NOT NULL,
    "festivalId" TEXT,
    "festivalSlug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "strategies" TEXT[],
    "refreshPolicy" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "editionYear" INTEGER NOT NULL,
    "manualReviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FestivalSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Festival_slug_key" ON "Festival"("slug");

-- CreateIndex
CREATE INDEX "Festival_countryCode_slug_idx" ON "Festival"("countryCode", "slug");

-- CreateIndex
CREATE INDEX "FestivalEdition_year_recordState_idx" ON "FestivalEdition"("year", "recordState");

-- CreateIndex
CREATE UNIQUE INDEX "FestivalEdition_festivalId_year_key" ON "FestivalEdition"("festivalId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_slug_key" ON "Artist"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistIdentity_artistId_provider_key" ON "ArtistIdentity"("artistId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistIdentity_provider_externalId_key" ON "ArtistIdentity"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistLink_artistId_url_key" ON "ArtistLink"("artistId", "url");

-- CreateIndex
CREATE INDEX "ArtistProvenance_artistId_field_idx" ON "ArtistProvenance"("artistId", "field");

-- CreateIndex
CREATE INDEX "LineupEntry_artistId_editionId_idx" ON "LineupEntry"("artistId", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "LineupEntry_editionId_artistId_key" ON "LineupEntry"("editionId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "LineupEntry_editionId_billing_position_key" ON "LineupEntry"("editionId", "billing", "position");

-- CreateIndex
CREATE INDEX "EditionProvenance_editionId_field_idx" ON "EditionProvenance"("editionId", "field");

-- CreateIndex
CREATE INDEX "TimetablePerformance_artistId_date_idx" ON "TimetablePerformance"("artistId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimetablePerformance_editionId_date_stage_start_artistName_key" ON "TimetablePerformance"("editionId", "date", "stage", "start", "artistName");

-- CreateIndex
CREATE UNIQUE INDEX "FestivalPlaylist_editionId_provider_key" ON "FestivalPlaylist"("editionId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "FestivalPlaylist_provider_url_key" ON "FestivalPlaylist"("provider", "url");

-- CreateIndex
CREATE INDEX "FestivalSource_enabled_refreshPolicy_idx" ON "FestivalSource"("enabled", "refreshPolicy");

-- CreateIndex
CREATE UNIQUE INDEX "FestivalSource_festivalSlug_url_key" ON "FestivalSource"("festivalSlug", "url");

-- AddForeignKey
ALTER TABLE "FestivalEdition" ADD CONSTRAINT "FestivalEdition_festivalId_fkey" FOREIGN KEY ("festivalId") REFERENCES "Festival"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistIdentity" ADD CONSTRAINT "ArtistIdentity_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistLink" ADD CONSTRAINT "ArtistLink_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistProvenance" ADD CONSTRAINT "ArtistProvenance_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupEntry" ADD CONSTRAINT "LineupEntry_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupEntry" ADD CONSTRAINT "LineupEntry_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditionProvenance" ADD CONSTRAINT "EditionProvenance_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetablePerformance" ADD CONSTRAINT "TimetablePerformance_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetablePerformance" ADD CONSTRAINT "TimetablePerformance_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FestivalPlaylist" ADD CONSTRAINT "FestivalPlaylist_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FestivalSource" ADD CONSTRAINT "FestivalSource_festivalId_fkey" FOREIGN KEY ("festivalId") REFERENCES "Festival"("id") ON DELETE SET NULL ON UPDATE CASCADE;
