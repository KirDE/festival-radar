# Ingestion persistence operations

PostgreSQL is the system of record for every ingestion run, attempt, immutable candidate,
bounded evidence excerpt and normalized diff. GitHub artifacts are optional 30-day diagnostic
exports. The workflow requires `DATABASE_URL` and creates the run before any network request.

Database backups follow the production PostgreSQL encrypted daily-backup policy, with restore
tests at least quarterly. Run and candidate metadata is retained indefinitely for audit lineage.
Evidence excerpts are limited to 2,000 characters and must not contain credentials or user data;
full HTML is not stored. Operators may delete diagnostic artifacts after 30 days. A scheduled
cleanup may remove evidence excerpts older than 24 months only after preserving hashes, diffs,
decisions, candidate lineage, and run counters. Review/publication rows must never be rewritten;
new decisions supersede prior candidate versions.

Operational queries are exported by `lib/ingestion/repository.ts`: latest result, run history,
candidate history and diff history per festival. `IngestionSourceState.lastSuccessfulCheck` is
updated in the same transaction as every successful attempt, so scheduling survives deployments.
