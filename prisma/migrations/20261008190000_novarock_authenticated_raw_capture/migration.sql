CREATE TABLE "NovaRockRawCardCapture" (
 "id" TEXT PRIMARY KEY, "sealId" TEXT NOT NULL UNIQUE, "candidateId" TEXT NOT NULL UNIQUE,
 "attemptId" TEXT NOT NULL UNIQUE, "sourceId" TEXT NOT NULL, "festivalId" TEXT NOT NULL,
 "editionId" TEXT NOT NULL, "configurationGeneration" INTEGER NOT NULL CHECK ("configurationGeneration" > 0),
 "leaseVersion" INTEGER NOT NULL CHECK ("leaseVersion" > 0), "reviewerId" TEXT NOT NULL,
 "sessionId" TEXT NOT NULL, "rawBytes" BYTEA NOT NULL CHECK (octet_length("rawBytes") BETWEEN 1 AND 524288),
 "rawDocumentSha256" CHAR(64) NOT NULL CHECK ("rawDocumentSha256" = encode(sha256("rawBytes"), 'hex')),
 "completedAt" TIMESTAMP(3) NOT NULL, "cards" JSONB NOT NULL CHECK (jsonb_typeof("cards") = 'array' AND jsonb_array_length("cards") = 44),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "NovaRaw_seal_fkey" FOREIGN KEY ("sealId") REFERENCES "NovaRockContentSeal"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "NovaRaw_candidate_fkey" FOREIGN KEY ("candidateId") REFERENCES "IngestionCandidate"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "NovaRaw_attempt_fkey" FOREIGN KEY ("attemptId") REFERENCES "IngestionAttempt"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "NovaRaw_source_fkey" FOREIGN KEY ("sourceId") REFERENCES "FestivalSource"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "NovaRaw_festival_fkey" FOREIGN KEY ("festivalId") REFERENCES "Festival"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "NovaRaw_edition_fkey" FOREIGN KEY ("editionId") REFERENCES "FestivalEdition"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "NovaRaw_reviewer_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- Session deletion/revocation must remain possible; sessionId is immutable historical identity.
CREATE FUNCTION nova_raw_capture_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src "FestivalSource"%ROWTYPE; c "IngestionCandidate"%ROWTYPE;
 a "IngestionAttempt"%ROWTYPE; s "NovaRockContentSeal"%ROWTYPE;
 e "FestivalEdition"%ROWTYPE; u "User"%ROWTYPE; sess "Session"%ROWTYPE;
 i INTEGER; item JSONB;
BEGIN
 -- Lock order: source, run, attempt, candidate, festival, edition, session, user.
 SELECT * INTO STRICT src FROM "FestivalSource" WHERE id = NEW."sourceId" FOR UPDATE;
 SELECT * INTO STRICT s FROM "NovaRockContentSeal" WHERE id = NEW."sealId";
 SELECT * INTO STRICT c FROM "IngestionCandidate" WHERE id = NEW."candidateId";
 PERFORM id FROM "IngestionRun" WHERE id = c."runId" FOR UPDATE;
 SELECT * INTO STRICT a FROM "IngestionAttempt" WHERE id = NEW."attemptId" FOR UPDATE;
 SELECT * INTO STRICT c FROM "IngestionCandidate" WHERE id = NEW."candidateId" FOR UPDATE;
 PERFORM id FROM "Festival" WHERE id = NEW."festivalId" FOR UPDATE;
 SELECT * INTO STRICT e FROM "FestivalEdition" WHERE id = NEW."editionId" FOR UPDATE;
 SELECT * INTO STRICT sess FROM "Session" WHERE id = NEW."sessionId" FOR UPDATE;
 SELECT * INTO STRICT u FROM "User" WHERE id = NEW."reviewerId" FOR UPDATE;
 IF NEW."completedAt" < clock_timestamp() - interval '60 seconds' OR
    NEW."completedAt" > clock_timestamp() + interval '1 second' THEN
   RAISE EXCEPTION 'Nova raw capture completion clock invalid'; END IF;
 IF NEW."sourceId" <> 'cmuaee22i00xy6ncnc5uf6xxk' OR NEW."editionId" <> 'cmuaee1xc00tf6ncn76ea3pu2' OR
   src."festivalId" IS DISTINCT FROM NEW."festivalId" OR src."editionId" IS DISTINCT FROM NEW."editionId" OR
   NOT src.enabled OR src."festivalSlug" <> 'nova-rock' OR src."editionYear" <> 2027 OR
   src.url <> 'https://www.novarock.at/lineup/' OR src."parserKey" IS DISTINCT FROM 'official_markup:nova-rock' OR
   src.strategies <> ARRAY['official_markup']::text[] OR src."fetchUrl" IS NOT NULL OR
   src."followLinkPattern" IS NOT NULL OR src."requestHeaders" IS NOT NULL OR
   src."leaseOwner" IS NOT NULL OR src."leaseExpiresAt" IS NOT NULL OR
   src."configurationGeneration" <> NEW."configurationGeneration" OR src."leaseVersion" <> NEW."leaseVersion" OR
   e."festivalId" <> NEW."festivalId" OR e.year <> 2027 OR e."recordState" <> 'CURRENT' OR
   s."candidateId" <> NEW."candidateId" OR s.version <> 1 OR c."attemptId" <> NEW."attemptId" OR
   c."reviewState" <> 'PENDING' OR c.publishable OR c."festivalSlug" <> 'nova-rock' OR
   a."runId" <> c."runId" OR a.status <> 'REVIEW' OR a."festivalSlug" <> 'nova-rock' OR
   sess."userId" <> NEW."reviewerId" OR sess."expiresAt" <= clock_timestamp() OR u.role <> 'ADMIN' OR
   s.snapshot->'attempt'->>'id' IS DISTINCT FROM NEW."attemptId" OR
   s.snapshot->'candidate'->>'id' IS DISTINCT FROM NEW."candidateId" OR
   s.snapshot->'attempt'->'acquisitionProvenance'->'configuration'->>'sourceId' IS DISTINCT FROM NEW."sourceId" OR
   (s.snapshot->'attempt'->'acquisitionProvenance'->>'configurationGeneration')::integer IS DISTINCT FROM NEW."configurationGeneration" OR
   (s.snapshot->'attempt'->'acquisitionProvenance'->>'leaseVersion')::integer IS DISTINCT FROM NEW."leaseVersion" THEN
   RAISE EXCEPTION 'Nova raw capture lineage drift'; END IF;
 IF EXISTS (SELECT 1 FROM "FestivalSource" WHERE enabled AND id <> src.id AND
     ("editionId" = NEW."editionId" OR ("festivalSlug" = 'nova-rock' AND "editionYear" = 2027))) OR
   (SELECT count(*) FROM "IngestionAttempt" WHERE "festivalSlug" = 'nova-rock' AND "endedAt" >= a."endedAt") <> 1 THEN
   RAISE EXCEPTION 'Nova raw capture competing source or attempt'; END IF;
 FOR i IN 0..43 LOOP
   item := NEW.cards->i;
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR
      (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(item) key) IS DISTINCT FROM ARRAY['billing','caption','day','officialUrl','position']::text[] OR
      jsonb_typeof(item->'caption') IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'officialUrl') IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'day') IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'billing') IS DISTINCT FROM 'string' OR
      jsonb_typeof(item->'position') IS DISTINCT FROM 'number' OR
      (length(item->>'caption') BETWEEN 1 AND 100) IS DISTINCT FROM TRUE OR
      ((item->>'officialUrl') ~ '^https://www[.]novarock[.]at/artist/[a-z0-9-]+/$') IS DISTINCT FROM TRUE OR
      ((item->>'day') IN ('2027-06-09','2027-06-10','2027-06-11','2027-06-12')) IS DISTINCT FROM TRUE OR
      item->>'billing' IS DISTINCT FROM (CASE WHEN i < 4 THEN 'HEADLINER' ELSE 'LINEUP' END) OR
      item->>'position' IS DISTINCT FROM (CASE WHEN i < 4 THEN i ELSE i-4 END)::text OR
      item->>'caption' IS DISTINCT FROM (CASE WHEN i < 4 THEN s.snapshot->'candidate'->'normalized'->'headliners'->>i
                                            ELSE s.snapshot->'candidate'->'normalized'->'lineup'->>(i-4) END) THEN
      RAISE EXCEPTION 'Nova raw capture ordered card drift'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER nova_raw_capture_insert BEFORE INSERT ON "NovaRockRawCardCapture" FOR EACH ROW EXECUTE FUNCTION nova_raw_capture_insert_guard();
CREATE FUNCTION nova_raw_capture_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Nova raw capture is append-only'; END; $$;
CREATE TRIGGER nova_raw_capture_no_update BEFORE UPDATE OR DELETE ON "NovaRockRawCardCapture" FOR EACH ROW EXECUTE FUNCTION nova_raw_capture_immutable();
CREATE TRIGGER nova_raw_capture_no_truncate BEFORE TRUNCATE ON "NovaRockRawCardCapture" FOR EACH STATEMENT EXECUTE FUNCTION nova_raw_capture_immutable();
