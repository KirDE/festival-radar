# Reviewed festival logo import (#210 phase 5)

This phase is **local staging only**. It does not switch public routes: the UI still reads static `/logos/<slug>.png` and the five fallback festivals still render initials. No arbitrary URL fetching, production import, deletion of static assets, or deployment is included. Do not activate DB serving until backup/restore, exact-head CI, production gates and an independently reviewed cutover plan pass.

## Reviewed source

`data/reviewed-logo-inventory.json` pins filename, festival slug, actual MIME, size and SHA-256 for every local file. The importer scans `public/logos`, requires an exact 47-file set and exact 47/52 festival coverage, rejects symlinks, and fully decodes each image with sharp (including all pixels) before touching the database. Eight `.png` filenames contain JPEG bytes; MIME follows decoded content rather than extension. Inventory totals: **47 images (39 PNG, 8 JPEG, 0 WebP), five fallback festivals**. WebP is supported and tested; none is currently in this source set. A changed asset requires explicit review and a new pinned inventory, not an import bypass. The script prints an auditable file-by-file report including digest, MIME, size, SHA and coverage.

## Commands

1. `npm ci`, `npm run logos:dry-run` for offline source audit; with `DATABASE_URL` set it also performs a no-write festival/binding preview. A conflicting existing binding fails closed.
2. Apply **only to a freshly migrated and backfilled disposable local PostgreSQL database** whose database name includes `test` or `integration`. Inspect the printed `inventoryDigest`, then run `npm run logos:apply -- --confirm-disposable=<exact-db-name> --expected-digest=<printed-sha256>`. The guard also requires a local hostname (not a remote URL), an exact DB-name confirmation and the reviewed digest. Do not tunnel a production DB through localhost or mislabel a production DB as disposable.
3. `npm run logos:verify` is strictly read-only and requires `DATABASE_URL`. It checks **all 47** bindings, MIME, hash, size and byte parity, rejecting extra bindings. Repeating the guarded apply has no binding timestamp churn. The write path is one transaction, with existing/manual binding conflicts rejected before inserts; any mid-import error rolls back all blobs and bindings.
4. CI runs `npm run test:logo-import` after catalog backfill on the disposable PostgreSQL service. Unit tests exercise truncated/corrupt images, MIME mismatch (including WebP), unexpected/missing/changed files, coverage, static binding and SHA parity; DB E2E exercises no-write preflight, partial failure rollback, idempotence, exact verification and conflicting binding. Existing asset-store tests run separately. Never run tests or apply against production.

This commit is intentionally local only. Before any future PR/merge or public-route change: verify both exact-head Quality checks and reviews, verify production deployed SHA/health, prove backup restore, obtain a dedicated guarded production import operation with observability and explicit authorization, then independently verify DB parity and fallback behavior. Static assets remain the rollback path.
