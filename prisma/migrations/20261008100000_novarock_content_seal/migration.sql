-- Integrity prerequisite only: no review approval, lifecycle transition or publication.
CREATE TABLE "NovaRockContentSeal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "candidateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" = 1),
  "contentDigest" TEXT NOT NULL CHECK ("contentDigest" ~ '^[a-f0-9]{64}$'),
  "snapshot" JSONB NOT NULL CHECK (jsonb_typeof("snapshot") = 'object'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NovaRockContentSeal_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "IngestionCandidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "NovaRockContentSeal_candidateId_key" ON "NovaRockContentSeal"("candidateId");

CREATE FUNCTION nova_content_seal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Nova Rock content seals are append-only';
END;
$$;
CREATE TRIGGER nova_content_seal_append_only BEFORE UPDATE OR DELETE ON "NovaRockContentSeal"
  FOR EACH ROW EXECUTE FUNCTION nova_content_seal_append_only();

-- Also fence direct SQL insertions: same lock order as the application.
CREATE FUNCTION nova_content_seal_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "IngestionCandidate"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT c FROM "IngestionCandidate" WHERE id = NEW."candidateId";
  PERFORM id FROM "IngestionRun" WHERE id = c."runId" FOR UPDATE;
  PERFORM id FROM "IngestionAttempt" WHERE id = c."attemptId" FOR UPDATE;
  SELECT * INTO STRICT c FROM "IngestionCandidate" WHERE id = NEW."candidateId" FOR UPDATE;
  IF c."reviewState" <> 'PENDING' THEN
    RAISE EXCEPTION 'Content seal creation requires PENDING candidate';
  END IF;
  IF c."festivalSlug" <> 'nova-rock' OR
     NEW.snapshot->>'version' IS DISTINCT FROM '1' OR
     NEW.snapshot->'candidate'->>'id' IS DISTINCT FROM c.id OR
     NEW.snapshot->'attempt'->>'id' IS DISTINCT FROM c."attemptId" OR
     NEW.snapshot->'run'->>'id' IS DISTINCT FROM c."runId" THEN
    RAISE EXCEPTION 'Invalid Nova Rock seal lineage';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nova_content_seal_lock BEFORE INSERT ON "NovaRockContentSeal"
  FOR EACH ROW EXECUTE FUNCTION nova_content_seal_lock();

-- Freeze only sealed data. Generic ingestion rows remain unaffected.
CREATE FUNCTION nova_content_sealed_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bound_id TEXT; sealed BOOLEAN;
BEGIN
  IF TG_TABLE_NAME IN ('IngestionEvidence', 'IngestionDiff') THEN
    IF TG_OP <> 'INSERT' THEN
      bound_id := OLD."candidateId";
      PERFORM id FROM "IngestionCandidate" WHERE id = bound_id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM "NovaRockContentSeal" WHERE "candidateId" = bound_id) THEN
        RAISE EXCEPTION 'Nova Rock sealed content is immutable';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      bound_id := NEW."candidateId";
      PERFORM id FROM "IngestionCandidate" WHERE id = bound_id FOR UPDATE;
      sealed := EXISTS (SELECT 1 FROM "NovaRockContentSeal" WHERE "candidateId" = bound_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'IngestionCandidate' THEN
    sealed := EXISTS (SELECT 1 FROM "NovaRockContentSeal" WHERE "candidateId" = OLD.id);
    -- Only these lifecycle columns may change. All content/lineage columns,
    -- including any future columns, remain protected by default.
    IF sealed AND TG_OP = 'UPDATE' THEN
      IF (to_jsonb(NEW) - ARRAY['reviewState', 'reviewActor', 'reviewedAt', 'publishedAt', 'catalogueVersion'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['reviewState', 'reviewActor', 'reviewedAt', 'publishedAt', 'catalogueVersion']) THEN
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'IngestionAttempt' THEN
    sealed := EXISTS (SELECT 1 FROM "NovaRockContentSeal" s JOIN "IngestionCandidate" c ON c.id = s."candidateId" WHERE c."attemptId" = OLD.id);
  ELSIF TG_TABLE_NAME = 'IngestionRun' THEN
    sealed := EXISTS (SELECT 1 FROM "NovaRockContentSeal" s JOIN "IngestionCandidate" c ON c.id = s."candidateId" WHERE c."runId" = OLD.id);
  END IF;
  IF sealed THEN RAISE EXCEPTION 'Nova Rock sealed content is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nova_sealed_candidate BEFORE UPDATE OR DELETE ON "IngestionCandidate" FOR EACH ROW EXECUTE FUNCTION nova_content_sealed_row();
CREATE TRIGGER nova_sealed_attempt BEFORE UPDATE OR DELETE ON "IngestionAttempt" FOR EACH ROW EXECUTE FUNCTION nova_content_sealed_row();
CREATE TRIGGER nova_sealed_run BEFORE UPDATE OR DELETE ON "IngestionRun" FOR EACH ROW EXECUTE FUNCTION nova_content_sealed_row();
CREATE TRIGGER nova_sealed_evidence BEFORE INSERT OR UPDATE OR DELETE ON "IngestionEvidence" FOR EACH ROW EXECUTE FUNCTION nova_content_sealed_row();
CREATE TRIGGER nova_sealed_diff BEFORE INSERT OR UPDATE OR DELETE ON "IngestionDiff" FOR EACH ROW EXECUTE FUNCTION nova_content_sealed_row();

CREATE FUNCTION nova_content_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'NovaRockContentSeal' OR EXISTS (SELECT 1 FROM "NovaRockContentSeal") THEN
    RAISE EXCEPTION 'Nova Rock sealed content is immutable; truncate forbidden';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER nova_seal_no_truncate BEFORE TRUNCATE ON "NovaRockContentSeal" FOR EACH STATEMENT EXECUTE FUNCTION nova_content_no_truncate();
CREATE TRIGGER nova_candidate_no_truncate BEFORE TRUNCATE ON "IngestionCandidate" FOR EACH STATEMENT EXECUTE FUNCTION nova_content_no_truncate();
CREATE TRIGGER nova_attempt_no_truncate BEFORE TRUNCATE ON "IngestionAttempt" FOR EACH STATEMENT EXECUTE FUNCTION nova_content_no_truncate();
CREATE TRIGGER nova_run_no_truncate BEFORE TRUNCATE ON "IngestionRun" FOR EACH STATEMENT EXECUTE FUNCTION nova_content_no_truncate();
CREATE TRIGGER nova_evidence_no_truncate BEFORE TRUNCATE ON "IngestionEvidence" FOR EACH STATEMENT EXECUTE FUNCTION nova_content_no_truncate();
CREATE TRIGGER nova_diff_no_truncate BEFORE TRUNCATE ON "IngestionDiff" FOR EACH STATEMENT EXECUTE FUNCTION nova_content_no_truncate();
