# Festival source configuration foundation (#210, phase 2a)

> Historical migration record. Git catalogue inputs and the one-off import/backfill
> commands described below were retired in the final #210 Git retirement.
> These are not current operational instructions. Database readers, source administration,
> asset storage, and workers remain the operational paths.


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

This is never part of deploy and is not scheduled. The existing constrained deploy SSH identity invokes only fixed activate-release COMMIT source-{preview,apply,verify} modes. The wrapper checks the exact live release, serializes with activation and starts a one-shot systemd unit as www-data with the protected server EnvironmentFile and packaged Node TypeScript-strip runtime (no tsx/devDependencies). For each dispatch the root wrapper writes a fresh, root-only mode-specific nonce environment file under `/run/festival-radar-source-backfill`, removes it on exit, and accepts only a matching full-line Node stdout audit from a bounded fresh root-owned private audit file for the exact unit. A missing nonce file or malformed nonce fails before DB access; a missing, stale, or unsafe audit cannot confirm success. The runner checks completed migration before touching source rows. Production apply fails closed on any drift, including marked DB-owned rows, and forwards only the nonce-redacted operation/mode/status/counts/drift audit to workflow logs; the full nonce-bound record is removed with the private file on exit. Source URLs and database errors are never forwarded. Verify requires zero remaining inserts/fills. If preview fails, use separately authorized protected DB review; do not bypass the gate or manually edit the release.

A complete legacy-config-conflict scan alone emits `conflictSummary.digest`, up to 20 sorted numeric tuples `[inventoryIndex, currentEditionYear, currentRefreshCode, currentStrategiesMask]`. The zero-based index refers to the versioned `festivalSources` array, not the subset of matching DB rows. Refresh codes are unknown=0, daily=1, every_3_days=2, weekly=3, archived=4. Strategy bits are json_ld_event=1, html_fallback=2, official_markup=4, manual_review=8, and unknown=16. The mask does not capture strategy order; the existing `strategies` field count still includes order-only mismatches. Summary counts derive from the complete read-only scan, not from a partial prefix. More than 20 conflicts or malformed/inconsistent output fails closed without a digest. No source identifiers, URLs, or unknown stored enum strings are exposed. Never use a conflict audit as authorization to apply.

The protected preview/apply/verify planner recognizes only three historical inventory transitions: Rock for People (#23, a4f9cf6), Greenfield (#41, fdcc074), and Tons of Rock (#45, b482118). It pins their original slug and URL, 2027 edition, original ordered strategies and refresh policy, and current desired configuration. An unmarked row is eligible only when enabled and all other configuration/runtime state remains untouched (except a null or matching festival binding). It fills the desired parser, cadence, edition binding, and source-specific fetch/link fields in the same transaction as the exact strategy/policy transition. This is not a general override: any different legacy tuple, populated parser/edition binding, other edits, or marked-row drift fails closed. Preview uses the same planner without any writes. Apply locks existing source rows before preflight and uses a serializable transaction and row-version conditional updates; conflicts roll back the entire operation. Re-run protected preview after any rejection; do not manually force a source update based on a numeric digest.
