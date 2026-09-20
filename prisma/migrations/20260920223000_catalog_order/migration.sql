-- Preserve the reviewed public catalogue order independently of repository fixtures.
ALTER TABLE "Festival" ADD COLUMN "catalogOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArtistIdentity" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArtistLink" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArtistProvenance" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
