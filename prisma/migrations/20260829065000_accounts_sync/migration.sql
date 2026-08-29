CREATE TYPE "SyncKind" AS ENUM ('FAVORITES', 'COLLECTIONS', 'SAVED_FILTERS', 'FESTIVAL_PLANS');

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "SyncDocument" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "kind" "SyncKind" NOT NULL, "payload" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SyncDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SyncDocument_userId_kind_key" UNIQUE ("userId", "kind")
);
CREATE TABLE "ShareLink" (
  "id" TEXT PRIMARY KEY, "slug" TEXT NOT NULL UNIQUE, "userId" TEXT NOT NULL, "documentId" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShareLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "ShareLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SyncDocument"("id") ON DELETE CASCADE
);
CREATE TABLE "SpotifyConnection" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE, "encryptedRefreshToken" TEXT NOT NULL, "spotifyUserId" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpotifyConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
