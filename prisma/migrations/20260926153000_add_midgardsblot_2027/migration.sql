BEGIN;

-- Keep the reviewed public order stable while placing Midgardsblot with the
-- other Norwegian festivals. A conflicting pre-existing slug must fail the
-- migration instead of silently overwriting manually entered catalogue data.
UPDATE "Festival"
SET "catalogOrder" = "catalogOrder" + 1
WHERE "catalogOrder" >= 46;

INSERT INTO "Festival" (
  "id", "slug", "name", "country", "countryCode", "city", "officialUrl",
  "latitude", "longitude", "genres", "catalogOrder", "createdAt", "updatedAt"
) VALUES (
  'catalog-festival-midgardsblot', 'midgardsblot', 'Midgardsblot Festival',
  'Norway', 'NO', 'Borre', 'https://midgardsblot.no/', 59.385, 10.4668,
  ARRAY['metal', 'folk metal', 'black metal'], 46, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "FestivalEdition" (
  "id", "festivalId", "year", "startDate", "endDate", "dateLabel", "status",
  "ticketStatus", "ticketsUrl", "recordState", "completeness", "sourceUpdatedAt",
  "snapshotAt", "createdAt", "updatedAt"
) VALUES (
  'catalog-edition-midgardsblot-2027', 'catalog-festival-midgardsblot', 2027,
  DATE '2027-08-18', DATE '2027-08-21', NULL, 'TBA', 'AVAILABLE',
  'https://www.ticketmaster.no/artist/midgardsblot-tickets/1197464', 'CURRENT', 'TBA',
  TIMESTAMP '2026-09-26 15:30:00', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "EditionProvenance" (
  "id", "editionId", "field", "url", "checkedAt", "note"
) VALUES (
  'catalog-provenance-midgardsblot-2027-dates', 'catalog-edition-midgardsblot-2027',
  'dates', 'https://midgardsblot.no/', TIMESTAMP '2026-09-26 15:30:00',
  'Official site publishes 18–21 August 2027 at Borre, Norway; the visible lineup remains labelled 2026 and is intentionally excluded.'
);

INSERT INTO "FestivalSource" (
  "id", "festivalId", "festivalSlug", "url", "strategies", "refreshPolicy",
  "enabled", "editionYear", "manualReviewReason", "createdAt", "updatedAt"
) VALUES (
  'catalog-source-midgardsblot', 'catalog-festival-midgardsblot', 'midgardsblot',
  'https://midgardsblot.no/', ARRAY['official_markup'], 'daily', true, 2027, NULL,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

COMMIT;
