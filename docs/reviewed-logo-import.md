# Reviewed festival logo import (#210 phase 5)

The original importer remains **local staging only** with its disposable-database guard. A separate manual production operation supports fixed `preview`, `apply`, and `verify` modes through the root-owned dispatcher and deployed release unit. This PR implements that operation; it does not execute it. The UI still reads static `/logos/<slug>.png` and the five fallback festivals still render initials. No arbitrary URL fetching, asset deletion, route changes, or automatic logo timer is included. DB serving requires a separately reviewed cutover plan.

## Reviewed source

`data/reviewed-logo-inventory.json` pins filename, festival slug, actual MIME, size and SHA-256 for every local file. The importer scans `public/logos`, requires an exact 47-file set and exact 47/52 festival coverage, rejects symlinks, and fully decodes each image with sharp (including all pixels) before touching the database. Eight `.png` filenames contain JPEG bytes; MIME follows decoded content rather than extension. Inventory totals: **47 images (39 PNG, 8 JPEG, 0 WebP), five fallback festivals**. WebP is supported and tested; none is currently in this source set. A changed asset requires explicit review and a new pinned inventory, not an import bypass. The script prints an auditable file-by-file report including digest, MIME, size, SHA and coverage.

## Commands

1. `npm ci`, `npm run logos:dry-run` for offline source audit; with `DATABASE_URL` set it also performs a no-write festival/binding preview. A conflicting existing binding fails closed.
2. Apply **only to a freshly migrated and backfilled disposable local PostgreSQL database** whose database name includes `test` or `integration`. Inspect the printed `inventoryDigest`, then run `npm run logos:apply -- --confirm-disposable=<exact-db-name> --expected-digest=<printed-sha256>`. The guard also requires a local hostname (not a remote URL), an exact DB-name confirmation and the reviewed digest. Do not tunnel a production DB through localhost or mislabel a production DB as disposable.
3. `npm run logos:verify` is strictly read-only and requires `DATABASE_URL`. It checks **all 47** bindings, MIME, hash, size and byte parity, rejecting extra bindings. Repeating the guarded apply has no binding timestamp churn. The write path is one transaction, with existing/manual binding conflicts rejected before inserts; any mid-import error rolls back all blobs and bindings.
4. CI runs `npm run test:logo-import` after catalog backfill on the disposable PostgreSQL service. Unit tests exercise truncated/corrupt images, MIME mismatch (including WebP), unexpected/missing/changed files, coverage, static binding and SHA parity; DB E2E exercises no-write preflight, partial failure rollback, idempotence, exact verification and conflicting binding. Existing asset-store tests run separately. Never run tests or apply against production.

The original local importer never authorized production writes and still refuses remote or non-disposable targets. The beta production authorization of 2026-10-05 permits implementation of the guarded write operation, but this task explicitly excludes production execution, deployment, merge and route cutover. Static assets remain the serving and rollback path.

## Manual production audit

After this PR is reviewed, merged and deployed, run the **Reviewed festival logo audit**
workflow on `main`, choosing `preview`. Its only other choice is `verify`,
which is expected to fail before the guarded import. Do **not** dispatch
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

## Guarded one-off apply (review and deploy before dispatch)

The source inventory digest remains immutable:
`99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456`.
The known successful preview run **37310572769** reported **47 files / existing 0**.
That historical preview is context, not authorization or a substitute for a fresh preview.

After review, merge and deployment, the operator can manually dispatch **Apply pinned
reviewed festival logos** on `main`. It has no push, deployment-completion or timer trigger.
The production environment must have required reviewers and restrict deployment branches
to `main`; a YAML environment declaration alone does not configure approval protection.
The operation shares the existing production concurrency group and refuses lock contention
on the host, including dispatch-asset upgrades. Root retains the deployment lock through worker completion and audit validation.

Before dispatch:

1. Complete a production DB backup. Restore **that exact backup** into an isolated
   database, validate the restored catalog/assets, and retain the backup artifact and
   restore test report securely. Record artifact SHA256 values, backup time, database
   identity, restore procedure/result, rollback operator and availability in the report.
   Keep credentials and connection URLs out of issue comments and workflow inputs.
2. Post this exact attestation format in an issue **#210** comment, substituting the
   deployed 40-character SHA and the two 64-character artifact digests. The final newline
   is optional but participates in the comment-body SHA256:

   ```text
   LOGO_IMPORT_BACKUP_RESTORE_V1
   deployment=<exact-deployed-main-sha>
   backup_sha256=<backup-artifact-sha256>
   restore_report_sha256=<restore-test-report-sha256>
   attestation=backup-restored-and-validated
   ```

3. Supply `deployment_sha`, the numeric `evidence_comment` ID, SHA256 of the exact
   comment body as `evidence_digest`, and explicitly select `restore_attested=true`.
   Type `APPLY-47-<deployment_sha>-<evidence_digest>` as `confirmation`. Leave
   `expected_existing=0` for the first import. `47` is only for an explicitly authorized,
   fully verified idempotent retry; partial inventories are rejected by production apply.

The workflow checks the exact dispatch SHA equals current `main`, requires successful
completed main Quality and Deploy runs for that same SHA, and fetches the issue comment
by ID to check issue identity, exact format, deployment SHA and body digest. It repeats
those checks immediately before apply. **This is an operator attestation of a tested
restore. The workflow does not download, restore or validate the backup itself.** Reviewers
must inspect the retained evidence before approving the production environment.

The workflow obtains a fresh read-only preview and requires exact 47-file source digest
and expected existing count. The dispatcher independently checks current release,
release marker, deployment-assets SHA, root-owned unit configuration and loopback
health under the deployment lock. Apply receives only fixed syntax confirmation,
count (`0` or `47`) and evidence digest; it cannot take arbitrary commands, slugs, paths
or URLs. Direct worker invocation additionally requires nonce, exact release marker,
matching environment SHA and the explicit apply confirmation. These guards prevent
operator accidents; they do not isolate `www-data`, which already owns the release
and has DB credentials. Backup/restore approval is enforced by the workflow/review,
not independently authenticated by the root dispatcher.

The importer copies source buffers, fully decodes and hashes them, then starts a
serializable transaction with bounded table-lock wait. It locks `Festival`, `AssetBlob`
and `FestivalLogo` against concurrent catalog, blob and binding mutations (including
new rows), reads all 52 festival identities **inside** that transaction, repeats preview
and expected count/digest immediately before inserting, rejects conflicting/manual
bindings and blob corruption, and inserts only pinned data. Existing matching bindings
are preserved without timestamp churn. It checks exact 47/47 MIME/hash/size/byte parity
inside the transaction and then performs another read-back after commit in a read-only
repeatable-read snapshot, so Prisma relation queries see consistent data. It never
retries serialization errors automatically. Table locks may briefly delay ordinary
catalog/asset writers; lock timeout fails closed. The post-commit read-back is a point
in time check; subsequent manual DB edits remain possible and require a new verify.

Only one bounded nonce-bound audit line is emitted after disconnect. Apply success
has distinct `preExisting`, `inserted`, and `postVerified:47` counts. Failures use fixed
statuses: `source-rejected`, `database-rejected`, `write-rejected`,
`post-commit-verify-failed`, or `disconnect-error`. Root rejects invalid byte framing,
NUL/binary, multiline/extra records, wrong nonce/digest, unexpected fields, inconsistent
counts, oversized records and worker failure even with an apparent success audit.
Raw worker output, errors, URLs and secrets are never relayed to the operator.

`post-commit-verify-failed` means writes may already be committed. A disconnect,
timeout, malformed audit, SSH failure, or lost transaction commit acknowledgement
(including `write-rejected`) can also leave an uncertain commit outcome.
**Do not report success, assume rollback, or blindly repeat apply.** Use the approved
`verify` operation against the same healthy deployed SHA and inspect the protected DB.
If parity holds, retain that independent verification evidence; a retry requires new
explicit confirmation with existing `47`. If parity fails, investigate and use the
reviewed backup/restore procedure under a separate operator decision. The workflow
does not automatically restore a DB or roll back production writes. It runs an
independent `verify` after a successful apply; any failure makes the job fail.

CI runs disposable-only production entrypoint integration tests after the local
importer tests via `npm run test:logo-import`: injected mid-import failure and rollback,
trigger-induced byte corruption, festival/count changes between outer preview and
transaction, actual competing-writer table locks, conflicts, idempotence/timestamps,
exact read-back and post-commit verification failure. Unit/wrapper tests exercise
invalid modes, missing confirmations, malformed/binary/multiline audit, wrong nonce,
count inconsistency and exact-head/evidence gates. None may target production.

Release packaging already includes the production runner and library/data source.
Installer unit backup/restore remains in place on failed deployments. Root dispatch
assets are upgraded separately and continue to reject an older restored release with
mismatched deployment-assets SHA. No logo unit is enabled or scheduled on deployment.
The 47 reviewed images still coexist with five static initials fallbacks.
