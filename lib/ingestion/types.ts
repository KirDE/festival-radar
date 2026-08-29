import type { Festival } from "../../data/festivals.ts";

export const INGESTION_SCHEMA_VERSION = 1 as const;
export type RefreshPolicy = "daily" | "every_3_days" | "weekly" | "archived";
export type ParserStrategy = "json_ld_event" | "html_fallback" | "manual_review";

export type FestivalSource = {
  festivalSlug: string;
  url: string;
  strategies: ParserStrategy[];
  refreshPolicy: RefreshPolicy;
  enabled: boolean;
  lastSuccessfulCheck?: string;
};

export type FieldEvidence = {
  field: keyof Pick<Festival, "startDate" | "endDate" | "city" | "headliners" | "lineup" | "ticketsUrl" | "status">;
  sourceUrl: string;
  observedAt: string;
  excerpt?: string;
};

export type FestivalCandidate = Partial<Pick<Festival, "startDate" | "endDate" | "city" | "headliners" | "lineup" | "ticketsUrl" | "status">> & {
  schemaVersion: typeof INGESTION_SCHEMA_VERSION;
  festivalSlug: string;
  sourceUrl: string;
  fetchedAt: string;
  evidence: FieldEvidence[];
  warnings: string[];
};

export type ChangeKind = "date_changed" | "city_changed" | "artist_added" | "artist_removed" | "headliner_added" | "headliner_removed" | "tickets_changed" | "status_changed";
export type FestivalChange = { kind: ChangeKind; field: string; before?: string; after?: string; reviewRequired: boolean; reason?: string };
export type IngestionResult = {
  schemaVersion: typeof INGESTION_SCHEMA_VERSION;
  festivalSlug: string;
  sourceUrl: string;
  fetchedAt: string;
  changes: FestivalChange[];
  candidate: FestivalCandidate;
  publishable: boolean;
  reviewReasons: string[];
};
