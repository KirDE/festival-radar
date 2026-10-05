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

The workflow accepts only `deployment_sha`, `expected_existing` (`0` or `47`),
and the explicit confirmation `APPLY-47-<deployment_sha>`. It has no push,
deployment-completion or timer trigger. Exact current-main Quality and Deploy
successes and a fresh preview/count/digest remain required and are rechecked
before apply. `production` is used for secret scoping only: it currently has **zero
required reviewers/protection rules**, and KirDE is the sole admin/reviewer.
Self-review and the environment declaration provide no independent restore assurance.
Issue comments, caller evidence digests and `restore_attested` have been removed.

### Independent root boundary and deliberate fail-closed state

`verify-logo-restore-proof.py` is installed separately as **root:root 0644** in
`/usr/local/libexec/festival-radar`. The dispatcher invokes `/usr/bin/python3 -I`
with fixed arguments and never executes application-owned code as root to verify
restore evidence. The verifier has no environment/CLI override for paths, hashes,
release identity, time, freshness or restore parity. The current sole trust anchor is:

- Archive: `/var/backups/festival-radar/festival_radar-pre-logo-20261005T132404Z-7a8a3d93.dump`
- Adjacent manifest: `/var/backups/festival-radar/festival_radar-pre-logo-20261005T132404Z-7a8a3d93.manifest.json` (replace `.dump` with `.manifest.json`)
- Archive size: `478057` bytes
- Archive SHA256: `9a29dc474f7fef612dc420c3a7928900c79203345a6f9e282d14206c40b53f20`
- Manifest SHA256: `d332e79d0b6169856f819b3c9fd675f31e5499daa3831588e434495542126079`
- Counts SHA256: `2ef57ad05d33e5e582820463b3c07ac8e90b0b69639c0be16283d0fc45c34b0c`
- Schema SHA256: `50bc36dd35b2cbc81e18fbbc1a2b3fd6f00a31f9d87c87cd8bea556e21c6ddea`
- Manifest release: `50402487d1fbb6a0d1fc5aa4526acaf664dc8e4f`

That archive was independently restored to an isolated **PG13 cluster with no TCP**;
42-table counts, schema, extensions, constraints and indexes matched, and the
cluster was removed. Root ownership, mode and hashes were independently checked.
This repository verifier authenticates that already proven immutable attestation;
it does **not** perform another restore or manufacture fresh backup evidence.
The failed `T132256Z-e3ff210e` archive is never accepted. Alternate archives, sibling
files and newly generated manifests are not discovered or trusted automatically.

The root verifier requires regular root:root 0600 archive/manifest files, single
links, no symlink path components, protected root-owned parents, exact size/digests,
duplicate-free bounded UTF-8 JSON, the exact 11 manifest fields and `parity:true`.
It checks the list of 42 unique `[table, count]` pairs with bounded integer counts,
`tables:42`, `blobRows:0`, `logoRows:0`, the exact `archive` path, a nonempty
schema object, and the independently pinned counts/schema digest fields, including
Festival=52, FestivalEdition=53, Artist=202,
FestivalSource=53, FestivalLogo=0 and AssetBlob=0. The full manifest SHA authenticates
its original serialization, all counts and complete schema; the verifier does not
invent a different canonical encoding for the historical sub-digests.

**The historical manifest release must equal the exact deployed SHA.** The code
never equates that old SHA with a future deployed release. Backup age is at most
**30 minutes**, measured from the immutable filename timestamp
`2026-10-05T13:24:04Z`, never from mutable file mtime or a newly written proof.
Consequently this PR's future deployed SHA (and an expired historical backup)
**cannot authorize production apply**. This is the deliberately chosen fail-closed
option, not a usable claim that the old restore protects a new deployment.

Before production apply can be enabled, a **new backup taken after deployment and
an independently validated isolated restore for that exact deployed SHA** are
required. Retain the root-owned immutable archive/manifest, full counts/schema and
restore verification evidence. A separately reviewed root provisioning/pin-update
operation must install that independently verified trust anchor without changing
the application SHA again. Merely editing code pins and deploying another release
would change the SHA again and is insufficient. This PR does not implement that
future provisioning operation, nor accept an operator-generated substitute. It
closes the unsafe human-attestation bypass now; apply stays blocked until that
separate requirement is fulfilled. No production artifact or proof was created by
this implementation task.

### Fixed proof operation and apply revalidation

The existing constrained `activate-release COMMIT logo-proof` dispatch takes the
shared deployment lock and validates the deployment-assets marker, current release,
release marker, installed unit and fixed loopback health. The root verifier checks
artifact identity/freshness/release and hashes the exact 47-file source inventory
and each source payload from that deployed release. It does not connect to the DB,
run migrations, create backups, restore data, start the app worker or change routes.
The existing deployed health endpoint supplies read-only DB health; a live-data
comparison/rebinding of the old backup to a new SHA is **not** implemented.

Only if those checks pass can it atomically write a canonical **root:root 0600**
proof to `/run/festival-radar-logo-restore-proof/proof.json` in a root:root 0700
directory. The proof binds exact SHA, source digest, archive/manifest/counts/schema
digests, restore parity, 47 files, 42 tables, immutable backup time, verification time
and expiry. Expiry is the earlier of five minutes after verification and the original
30-minute backup-age limit. Issuing a new proof cannot refresh the backup age.
The proof operation returns only an allowlisted single-line SHA/source/digest/expiry
audit. The dispatcher validates the original private audit bytes with root-owned
code before any shell newline/NUL normalization. Actions also validates exact byte framing, field order/types, source/SHA, freshness
and counts before deriving `proof_digest`; the digest is never a workflow input.

Apply receives the typed SHA confirmation, expected count and that derived root
proof digest. **Inside the host deployment lock immediately before starting the
write unit**, root reopens the protected proof, checks canonical bytes and exact
digest/freshness/fields, rehashes the pinned archive and manifest, and repeats exact
release/source verification. It checks proof expiry again after reading the source.
An absent, forged, malformed, stale, replaced or wrong-SHA/source proof fails before
`systemctl start`. The worker gets the root-derived digest through its protected
nonce environment, not caller evidence. Direct worker access is still not a DB
security boundary: `www-data` already owns the release and DB credentials.

The operation shares production concurrency and the host lock with activation and
dispatch-asset upgrades. Routine Deploy and the manual preview/verify modes retain
their behavior; deployment merely packages/installs the verifier and never issues
proof or applies logos. Unit rollback on failed installation is unchanged. An older
restored release with a mismatched deployment-assets SHA is rejected; missing/stale
root verifier assets block proof/apply, while preview/verify remain available.

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
count inconsistency and exact-head/root-proof gates. Python tests cover forged/private-file
ownership, symlinks, failed archives, malformed manifests, all proof fields, future SHA,
backup/proof expiry, changed source and repeated root verification. Root asset repair
and package/rollback contract tests cover verifier ownership and installation. None may target production.

Release packaging already includes the production runner and library/data source.
Installer unit backup/restore remains in place on failed deployments. Root dispatch
assets are upgraded separately and continue to reject an older restored release with
mismatched deployment-assets SHA. No logo unit is enabled or scheduled on deployment.
The 47 reviewed images still coexist with five static initials fallbacks.
