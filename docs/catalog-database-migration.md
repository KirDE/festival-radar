# Catalogue database migration

Issue [#195](https://github.com/KirDE/festival-radar/issues/195) tracks the staged move from repository data files to PostgreSQL.

## Phase 1: foundation

The first phase is deliberately additive. The application continues to read the existing files while the normalized tables, backfill, and parity gate are introduced.

Apply migrations and backfill an environment:

```bash
npx prisma migrate deploy
npm run catalog:backfill
npm run catalog:verify
```

`catalog:backfill` is idempotent. It aborts before writing when an existing festival slug, artist slug, or external artist identity belongs to conflicting data. All catalogue writes run in one serializable transaction.

The command prints a machine-readable parity report and exits non-zero if counts or ordered lineups differ. Do not switch reads to PostgreSQL unless both backfill and `catalog:verify` return `"ok": true` for the target environment.

## Rollback

Phase 1 does not change the runtime read path. If backfill fails, production keeps using the repository catalogue. Fix the conflict and rerun the idempotent command; do not drop or truncate shared database tables.

## Phase 2: read path and kill switch

All public catalogue consumers read through `lib/catalog/repository.ts`. The
default remains deliberately file-backed until a target database has passed
`catalog:backfill` and `catalog:verify`:

```bash
CATALOG_READ_MODE=files
```

After parity succeeds, enable PostgreSQL reads with:

```bash
CATALOG_READ_MODE=database
```

Database errors fail closed by default. During the temporary migration window,
`CATALOG_DATABASE_FALLBACK_ENABLED=true` explicitly permits the repository
files as an operator-selected emergency fallback.

## Phase 3: transactional publication

Production ingestion persists its candidate, evidence, and field-level diff
before publication. A publishable candidate then updates the normalized
festival, edition, artist, and lineup rows in one serializable transaction. The
same transaction marks the candidate published, appends an immutable
`CatalogPublication` snapshot, and enqueues a `CatalogPlaylistRefresh` when a
lineup or headliner changed. Review-required diffs, edition mismatches, stale
before-values, artist-slug collisions, and ambiguous billing all abort without
partial catalogue writes.

Approved festival and festival-link changes from the admin console use the same
catalogue transaction. The existing append-only admin audit entry records the
catalogue publication ID and whether a playlist refresh was requested.

The playlist worker exports its input from PostgreSQL whenever `DATABASE_URL`
is available. Successful provider read-back updates `FestivalPlaylist` and
marks matching refresh requests succeeded in one transaction; a failed refresh
leaves a durable failed request for retry.

During this phase the runtime publication overlay is still updated after a
successful database commit so the explicit `CATALOG_READ_MODE=files` kill
switch remains usable. PostgreSQL publication is the authoritative commit; the
file overlay is transitional and is removed in phase 5.

## Phase 4: production cutover

The production release environment sets `CATALOG_READ_MODE=database` without a
file fallback. On the first activation that changes from file mode to database
mode, the privileged installer runs the idempotent backfill and an independent
parity verification after migrations and before it activates the release. A
failed backfill or parity report leaves the previous release and environment
active.

Catalogue pages and the sitemap are rendered dynamically after cutover so
ingestion and admin publications become visible without a deploy. The
deployment health response reports `catalog: "database"` and live catalogue
counts; deployment verification requires that marker in addition to the exact
commit and database health.
