-- A sent creation intent is never resent, even after timeout or lease loss.
-- Provider discovery/read-back recovers the ID before catalog publication.
ALTER TABLE "CatalogPlaylistRefresh" ADD COLUMN "spotifyCreation" JSONB;
