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
