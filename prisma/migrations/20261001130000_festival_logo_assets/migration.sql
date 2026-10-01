-- Storage only: no data backfill, URL change, or serving route.
CREATE TABLE "AssetBlob" (
  "sha256" CHAR(64) NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "bytes" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetBlob_pkey" PRIMARY KEY ("sha256"),
  CONSTRAINT "AssetBlob_sha256_format_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AssetBlob_mime_type_check" CHECK ("mimeType" IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT "AssetBlob_size_check" CHECK ("sizeBytes" BETWEEN 1 AND 2097152 AND "sizeBytes" = octet_length("bytes"))
);

CREATE TABLE "FestivalLogo" (
  "festivalId" TEXT NOT NULL,
  "assetHash" CHAR(64) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FestivalLogo_pkey" PRIMARY KEY ("festivalId")
);

CREATE INDEX "FestivalLogo_assetHash_idx" ON "FestivalLogo"("assetHash");
ALTER TABLE "FestivalLogo" ADD CONSTRAINT "FestivalLogo_festivalId_fkey"
  FOREIGN KEY ("festivalId") REFERENCES "Festival"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FestivalLogo" ADD CONSTRAINT "FestivalLogo_assetHash_fkey"
  FOREIGN KEY ("assetHash") REFERENCES "AssetBlob"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;
