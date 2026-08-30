CREATE TABLE "AnalyticsDaily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsDaily_day_path_locale_key" ON "AnalyticsDaily"("day", "path", "locale");
CREATE INDEX "AnalyticsDaily_day_idx" ON "AnalyticsDaily"("day");
