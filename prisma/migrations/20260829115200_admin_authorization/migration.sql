CREATE TYPE "UserRole" AS ENUM ('USER', 'EDITOR', 'ADMIN');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

CREATE TABLE "AdminAuditEntry" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditEntry_createdAt_idx" ON "AdminAuditEntry"("createdAt");
CREATE INDEX "AdminAuditEntry_actorId_createdAt_idx" ON "AdminAuditEntry"("actorId", "createdAt");
ALTER TABLE "AdminAuditEntry" ADD CONSTRAINT "AdminAuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
