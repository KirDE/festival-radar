# Reviewed festival logo import (#210 phase 5)

The original importer is **local staging only**. The separate production operation added later is strictly read-only (preview and verify); it has no production apply mode. It does not switch public routes: the UI still reads static `/logos/<slug>.png` and the five fallback festivals still render initials. No arbitrary URL fetching, production import, deletion of static assets, or production execution is included. Do not activate DB serving until backup/restore, exact-head CI, production gates and an independently reviewed cutover plan pass.

## Reviewed source

`data/reviewed-logo-inventory.json` pins filename, festival slug, actual MIME, size and SHA-256 for every local file. The importer scans `public/logos`, requires an exact 47-file set and exact 47/52 festival coverage, rejects symlinks, and fully decodes each image with sharp (including all pixels) before touching the database. Eight `.png` filenames contain JPEG bytes; MIME follows decoded content rather than extension. Inventory totals: **47 images (39 PNG, 8 JPEG, 0 WebP), five fallback festivals**. WebP is supported and tested; none is currently in this source set. A changed asset requires explicit review and a new pinned inventory, not an import bypass. The script prints an auditable file-by-file report including digest, MIME, size, SHA and coverage.

## Commands

1. `npm ci`, `npm run logos:dry-run` for offline source audit; with `DATABASE_URL` set it also performs a no-write festival/binding preview. A conflicting existing binding fails closed.
2. Apply **only to a freshly migrated and backfilled disposable local PostgreSQL database** whose database name includes `test` or `integration`. Inspect the printed `inventoryDigest`, then run `npm run logos:apply -- --confirm-disposable=<exact-db-name> --expected-digest=<printed-sha256>`. The guard also requires a local hostname (not a remote URL), an exact DB-name confirmation and the reviewed digest. Do not tunnel a production DB through localhost or mislabel a production DB as disposable.
3. `npm run logos:verify` is strictly read-only and requires `DATABASE_URL`. It checks **all 47** bindings, MIME, hash, size and byte parity, rejecting extra bindings. Repeating the guarded apply has no binding timestamp churn. The write path is one transaction, with existing/manual binding conflicts rejected before inserts; any mid-import error rolls back all blobs and bindings.
4. CI runs `npm run test:logo-import` after catalog backfill on the disposable PostgreSQL service. Unit tests exercise truncated/corrupt images, MIME mismatch (including WebP), unexpected/missing/changed files, coverage, static binding and SHA parity; DB E2E exercises no-write preflight, partial failure rollback, idempotence, exact verification and conflicting binding. Existing asset-store tests run separately. Never run tests or apply against production.

The original local importer never authorized production writes. Before any production apply or public-route change: verify exact-head checks and reviews, deployed SHA/health, and backup restore; independently review an authorized write operation, then verify DB parity and fallback behavior. Static assets remain the rollback path.

## Manual production read-only gate (separate PR)

After this PR is reviewed, merged and deployed, run the **Reviewed festival logo audit**
workflow on `main`, choosing `preview`. Its only other choice is `verify`,
which is expected to fail before a future authorized import. Do **not** dispatch
this workflow before verifying exact-head Quality/Deploy, deployed SHA and live
health. Both modes use the shared production concurrency group, exact release
marker and root-owned allowlisted activation. The runner checks the immutable
47-file inventory digest `99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456`,
full image decode and database bindings. The preview performs no writes and
rejects manual/conflicting bindings. Verify requires exact 47/47 byte parity;
it cannot treat missing bindings as success. Only a fixed-status/count digest
is exported; raw exception text and DB credentials never reach the workflow. This
operator boundary does not isolate the app user (`www-data`), which already has
application database access. If a deploy fails, the manual logo unit is restored
(or removed on first installation); the separately upgraded root dispatcher remains
but refuses an older release because its deployment-assets SHA no longer matches.

**Not included:** production apply, production DB mutations, route cutover,
fallback removal, asset deletion, or timer changes. A separate reviewed apply
PR must add a privileged explicitly authorized write dispatch (not an ad-hoc
invocation of the local disposable importer), plus a verified backup/restore
record, fresh preview and exact deployed SHA. Verify production parity after
that approved apply, then separately review routes/cache/fallback and rollback.
The 47 reviewed images still coexist with five static initials fallbacks.
