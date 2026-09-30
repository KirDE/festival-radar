# Festival source configuration foundation (#210, phase 2a)

This release adds nullable configuration/state columns and an optional edition relation to the existing FestivalSource table. The migration never reads repository data or replaces source rows; it can be deployed before any source cutover. The existing ingestion runner, admin reads, and deploy behaviour still read their previous sources. No scheduler or DB-backed runtime path is activated by this PR. New rows retain legacy strategies, refreshPolicy, editionYear and enabled for compatibility.

## One-time operator action (not part of deploy)

Only after catalog rows and editions exist, use the appropriate DATABASE_URL with:

1. npm run sources:preview — read-only plan, including natural-key inserts/fills and drift.
2. Investigate every missing edition or conflicting binding; fix deliberately, never force one from a different year/festival.
3. npm run sources:backfill — explicit one-time insert or fill of null configuration; no catalogue/artist/edition writes.
4. npm run sources:verify — reports parity; exits nonzero for missing work or drift.

The pair (festivalSlug, url), not slug alone, identifies a source. The parser key encodes the ordered strategy pipeline and, for official markup, its registered festival adapter. Invalid parser, URL, regex or edition aborts the transaction. The disabled MetalDays source may have no edition; it stays disabled and is not silently rebound. Fetch overrides and follow links remain per source. Cadence is seconds; nextRunAt is intentionally null at migration/backfill (later scheduler must initialize it), as are leases, validators and attempt timestamps. Existing lastSuccessfulCheck belongs to the old ingestion state and is not copied into new per-source state.

Backfill marks rows once with configurationBackfilledAt. On rerun it never changes marked rows, even if an operator clears a field to NULL. On first pass it only fills NULL fields on legacy rows; existing non-NULL values remain authoritative. Preview/parity drift indicates expected differences without modifying them. Existing catalogue backfill remains unchanged for legacy tests/tools: **do not run catalog:backfill after editing source configuration in the DB**; it still upserts legacy source fields (strategies, policy, enabled, edition year). It is not a continuing source configuration mechanism. The eventual runtime/admin cutover must remove catalogue source upserts, adopt the typed repository, wire per-source due/lease and HTTP state, and re-evaluate parity against DB-authoritative edits. This phase deliberately does not schedule or ingest using the DB configuration.

For local verification use only a disposable test/integration PostgreSQL database and synthetic fixtures; never point test scripts at production.
