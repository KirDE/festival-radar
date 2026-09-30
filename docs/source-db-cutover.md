# Festival source configuration foundation (#210, phase 2a)

This release adds nullable configuration/state columns and an optional edition relation to the existing FestivalSource table. The migration never reads repository data or replaces source rows; it can be deployed before any source cutover. The existing ingestion runner, admin reads, and deploy behaviour still read their previous sources. No scheduler or DB-backed runtime path is activated by this PR. New rows retain legacy strategies, refreshPolicy, editionYear and enabled for compatibility.

## One-time operator action (not part of deploy)

For local/disposable databases only, with catalogue rows and editions present, use:

1. npm run sources:preview — read-only plan, including natural-key inserts/fills and drift.
2. Investigate every missing edition or conflicting binding; fix deliberately, never force one from a different year/festival.
3. npm run sources:backfill — explicit one-time insert or fill of null configuration; no catalogue/artist/edition writes.
4. npm run sources:verify — reports parity; exits nonzero for missing work or drift.

The pair (festivalSlug, url), not slug alone, identifies a source. The parser key encodes the ordered strategy pipeline and, for official markup, its registered festival adapter. Invalid parser, URL, regex or edition aborts the transaction. The disabled MetalDays source is absent from the active festival catalogue; it stays disabled with no festival or edition relation and is never silently rebound. Fetch overrides and follow links remain per source. Cadence is seconds; nextRunAt is intentionally null at migration/backfill (later scheduler must initialize it), as are leases, validators and attempt timestamps. Existing lastSuccessfulCheck belongs to the old ingestion state and is not copied into new per-source state.

Backfill marks rows once with configurationBackfilledAt. On rerun it never changes marked rows, even if an operator clears a field to NULL. On first pass it only fills NULL fields on legacy rows; existing non-NULL values remain authoritative. Preview/parity drift indicates expected differences without modifying them. Apply rejects any drift on a not-yet-marked legacy row before writing any source or marker; resolve that conflict and preview again. Drift on already-marked DB-owned rows is reported but never written back, and does not block unrelated first-time rows. Existing catalogue backfill remains unchanged for legacy tests/tools: **do not run catalog:backfill after editing source configuration in the DB**; it still upserts legacy source fields (strategies, policy, enabled, edition year). It is not a continuing source configuration mechanism. The eventual runtime/admin cutover must remove catalogue source upserts, adopt the typed repository, wire per-source due/lease and HTTP state, and re-evaluate parity against DB-authoritative edits. This phase deliberately does not schedule or ingest using the DB configuration.

For local verification use only a disposable test/integration PostgreSQL database and synthetic fixtures; never point test scripts at production.

## Protected production execution after deployment

Do not use the local npm commands or put DATABASE_URL on an SSH command line. After merge and successful deployment of the same main commit (including migration 20260930190000_source_configuration_foundation), manually dispatch GitHub Actions workflow source-backfill.yml on main in order: preview, inspect sanitized counts and drift status, apply only if clean, then verify. Review the production-environment approval for each dispatch.

    gh workflow run source-backfill.yml --ref main -f mode=preview
    gh workflow run source-backfill.yml --ref main -f mode=apply
    gh workflow run source-backfill.yml --ref main -f mode=verify

This is never part of deploy and is not scheduled. The existing constrained deploy SSH identity invokes only fixed activate-release COMMIT source-{preview,apply,verify} modes. The wrapper checks the exact live release, serializes with activation and starts a one-shot systemd unit as www-data with the protected server EnvironmentFile and packaged Node TypeScript-strip runtime (no tsx/devDependencies). The runner checks completed migration before touching source rows. Production apply fails closed on any drift, including marked DB-owned rows, and logs only counts/status, never source URLs or database errors. Verify requires zero remaining inserts/fills. If preview fails, use separately authorized protected DB review; do not bypass the gate or manually edit the release.
