-- Nullable: historical attempts are never backfilled from current configuration.
ALTER TABLE "IngestionAttempt" ADD COLUMN "acquisitionProvenance" JSONB;
ALTER TABLE "FestivalSource" ADD COLUMN "configurationGeneration" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0;

-- Database fence covers all writers, including raw SQL and URL swap-away/back.
CREATE FUNCTION ingestion_source_configuration_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."festivalId", NEW."festivalSlug", NEW."editionId", NEW."editionYear", NEW.url,
         NEW."parserKey", NEW.strategies, NEW."fetchUrl", NEW."followLinkPattern", NEW."requestHeaders",
         NEW.enabled, NEW."refreshPolicy", NEW."cadenceSeconds", NEW."manualReviewReason", NEW."configurationBackfilledAt")
     IS DISTINCT FROM
     ROW(OLD."festivalId", OLD."festivalSlug", OLD."editionId", OLD."editionYear", OLD.url,
         OLD."parserKey", OLD.strategies, OLD."fetchUrl", OLD."followLinkPattern", OLD."requestHeaders",
         OLD.enabled, OLD."refreshPolicy", OLD."cadenceSeconds", OLD."manualReviewReason", OLD."configurationBackfilledAt") THEN
    NEW."configurationGeneration" := OLD."configurationGeneration" + 1;
  ELSE
    NEW."configurationGeneration" := OLD."configurationGeneration";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ingestion_source_configuration_generation BEFORE UPDATE ON "FestivalSource"
FOR EACH ROW EXECUTE FUNCTION ingestion_source_configuration_generation();
