CREATE TYPE "AdminResourceKind" AS ENUM ('FESTIVAL', 'ARTIST', 'LINK', 'ASSET', 'PLAYLIST');
CREATE TYPE "AdminDraftStatus" AS ENUM ('DRAFT', 'QUEUED', 'APPLIED', 'REJECTED', 'CONFLICT');
CREATE TYPE "AdminChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CONFLICT');
CREATE TYPE "AdminRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

CREATE TABLE "AdminDraft" (
  "id" TEXT NOT NULL,
  "resourceKind" "AdminResourceKind" NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "AdminDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "values" JSONB NOT NULL,
  "validation" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminResourceState" (
  "resourceKind" "AdminResourceKind" NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "values" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminResourceState_pkey" PRIMARY KEY ("resourceKind", "resourceKey")
);

CREATE TABLE "AdminParserRun" (
  "id" TEXT NOT NULL,
  "festivalSlug" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "adapter" TEXT NOT NULL,
  "status" "AdminRunStatus" NOT NULL DEFAULT 'RUNNING',
  "requestedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "extracted" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT,
  "log" JSONB NOT NULL,
  CONSTRAINT "AdminParserRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminChange" (
  "id" TEXT NOT NULL,
  "resourceKind" "AdminResourceKind" NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "beforeValue" JSONB NOT NULL,
  "afterValue" JSONB NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "confidence" INTEGER,
  "status" "AdminChangeStatus" NOT NULL DEFAULT 'PENDING',
  "draftId" TEXT,
  "parserRunId" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditEntry" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceKind" "AdminResourceKind",
  "resourceKey" TEXT,
  "beforeValue" JSONB,
  "afterValue" JSONB,
  "evidence" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminDraft_resourceKind_resourceKey_revision_key" ON "AdminDraft"("resourceKind", "resourceKey", "revision");
CREATE INDEX "AdminDraft_resourceKind_resourceKey_status_idx" ON "AdminDraft"("resourceKind", "resourceKey", "status");
CREATE INDEX "AdminDraft_createdById_updatedAt_idx" ON "AdminDraft"("createdById", "updatedAt");
CREATE INDEX "AdminChange_status_createdAt_idx" ON "AdminChange"("status", "createdAt");
CREATE INDEX "AdminChange_resourceKind_resourceKey_status_idx" ON "AdminChange"("resourceKind", "resourceKey", "status");
CREATE INDEX "AdminChange_parserRunId_idx" ON "AdminChange"("parserRunId");
CREATE INDEX "AdminParserRun_festivalSlug_startedAt_idx" ON "AdminParserRun"("festivalSlug", "startedAt");
CREATE INDEX "AdminParserRun_status_startedAt_idx" ON "AdminParserRun"("status", "startedAt");
CREATE INDEX "AdminAuditEntry_createdAt_idx" ON "AdminAuditEntry"("createdAt");
CREATE INDEX "AdminAuditEntry_resourceKind_resourceKey_createdAt_idx" ON "AdminAuditEntry"("resourceKind", "resourceKey", "createdAt");
CREATE INDEX "AdminAuditEntry_actorId_createdAt_idx" ON "AdminAuditEntry"("actorId", "createdAt");

ALTER TABLE "AdminDraft" ADD CONSTRAINT "AdminDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminParserRun" ADD CONSTRAINT "AdminParserRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminChange" ADD CONSTRAINT "AdminChange_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "AdminDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminChange" ADD CONSTRAINT "AdminChange_parserRunId_fkey" FOREIGN KEY ("parserRunId") REFERENCES "AdminParserRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminChange" ADD CONSTRAINT "AdminChange_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAuditEntry" ADD CONSTRAINT "AdminAuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_admin_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditEntry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminAuditEntry_immutable_update" BEFORE UPDATE ON "AdminAuditEntry" FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_mutation();
CREATE TRIGGER "AdminAuditEntry_immutable_delete" BEFORE DELETE ON "AdminAuditEntry" FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_mutation();
