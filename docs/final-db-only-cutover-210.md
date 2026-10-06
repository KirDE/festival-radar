# Final cutover candidate and release gates for #210

Repository-only work against `05accea5c038b5eba91bc1e322530f4389c7508d`, left uncommitted. No production access, migrations, deployment or worker activation was performed here. The controller reports a fresh production backup and successful isolated restore; those facts still need to be bound to the protected cutover receipt. Full preservation parity between remaining files and the authoritative DB has **not** been verified. Standard deployment deliberately preserves those files until that specific blocker is resolved. This candidate does not complete #210.

## Commands and CI

`test:final-cutover`, `test:final-cutover-db`, `catalog:audit-final`, `operational:import`, `playlists:cutover`, and `playlists:worker` are defined in package.json. The `pretest:final-cutover-db` hook first validates a loopback disposable test/integration PostgreSQL URL, then generates Prisma and applies migrations. The E2E setup checks that both the generated client and PostgreSQL expose OperationalState and desiredPlan. Quality CI invokes the DB tests after its existing migration/reset steps and installs Python dependencies before the focused tests.

All operational commands are packaged and archive entries are checked. On an authorized server, an operator can run the packaged Node runtime with `--experimental-strip-types` and the protected application environment, as the application user. These commands do not require tsx in production. No new arbitrary-path SSH/sudo dispatcher or authenticated HTTP database runner is introduced. Production execution remains a controller/operator action; do not put DATABASE_URL on a command line or expose it in logs.

## Preserve legacy playlists until actual activation

The existing Tue/Fri collection timer and legacy provider path remain the default. The HTTP route continues its existing refresh behavior in that mode. An unset environment flag no longer disables work: `PLAYLIST_DB_WORKER_ENABLED` is not an activation mechanism. The route, collection dispatcher, direct DB-worker command, and activation command share the historical refresh.lock. The lock spans provider effects **and** the HTTP route's DB acknowledgement, and mode is read only after acquiring it. The internal route passes lock ownership to its child dispatcher to avoid nested locking. Do not invoke the legacy provider shell outside the locked dispatcher.

The new ten-minute playlists-db timer is installed dormant and is never automatically enabled. Activation requires the exact DEPLOYED_COMMIT, a preview queue hash, no RUNNING rows, no retained owners/expiries, and no FAILED rows with missing retryAt. The command never bulk resets old jobs. Invalid mode records or DB errors fail closed rather than falling back to another consumer. The validated DB mode persists in OperationalState across deployments.

Authorized rollout after review:

1. Stop/disable the legacy playlist timer and drain all old route/collection invocations. Reconcile legacy rows individually after provider read-back; do not infer success from age.
2. Run the packaged `scripts/playlist-cutover.ts` without --activate to preview. Inspect the sanitized count, blocked count and hash. An outstanding process either holds the shared lock or leaves a RUNNING row that prevents activation.
3. Run it with `--activate --confirm-legacy-drained --commit=<exact live SHA> --expected-queue-hash=<preview hash>`. The drain confirmation is an explicit operator attestation that old process trees and in-flight calls have ended; a lock or queue age alone cannot prove that after a crash. The command holds the same lock, locks queue rows, compares the exact hash and writes the durable activation receipt transactionally.
4. Enable `festival-radar-collection-playlists-db.timer`. Its dispatcher refuses to run before DB activation. Direct legacy timer invocations also select DB mode after activation, and all consumers are serialized by the same lock. The old timer may be re-enabled by the existing deploy installer, but it cannot select the legacy provider once the durable DB mode exists; keep it disabled operationally to avoid redundant polls.

The DB worker reuses existing DB-clock claims, renewal, attempt fencing and the two-hour cap. Selection is read-only; its plan is persisted before effects. Existing playlist IDs are read from DB; hardcoded ID overrides and historical fallback lineups are removed from execution. **No new real-data inventory is added to Git.** Historical recovery belongs in the controller's private backup, including the existing 13 DB playlist rows. Missing DB bindings fail closed; automatic playlist creation remains blocked. Retries replace partial contents, do not blindly retry ambiguous append writes, and verify complete ordered provider read-back before atomic catalogue/queue success. In-flight provider effects cannot be revoked, so this is convergent retry rather than exactly-once external execution. A stale plan after a newer completed publication requires reconciliation.

## One-time file retirement through the actual deploy workflow

After full file preservation parity is reviewed, configure the protected production environment variable `DB_ONLY_RELEASE=true` and secret `DB_ONLY_CUTOVER_ATTESTATION` before deployment of the cutover commit. The existing deploy workflow writes that receipt to a private runner file and passes it to package-release.sh. Missing or invalid evidence aborts packaging. No second source change is needed to enable the prepared path. Keep the variable false until parity is verified; shipping the default archive is a staged release, not a DB-only cutover.

The version-2 receipt schema is:

```json
{
  "version": 2,
  "kind": "db-only-cutover",
  "cutoverCommit": "<40-character reviewed cutover SHA>",
  "preservation": {
    "verified": true,
    "reviewedDifferences": true,
    "missing": 0,
    "conflicts": 0,
    "fileInventoryHash": "<64-character private file inventory SHA-256>",
    "databaseInventoryHash": "<64-character private DB inventory SHA-256>"
  },
  "restore": { "verified": true, "backupHash": "<64-character restored backup SHA-256>" }
}
```

The controller must account for all edition years, artist enrichment/provenance, sources/configuration, logos, timetable rows, public URLs and Spotify/YouTube playlist IDs. Legitimate DB-owned changes are reviewed differences, not an instruction to overwrite DB with seeds. The receipt is an explicit operator attestation protected by the deployment environment, not cryptographic proof fabricated by this code. The initial commit must match the receipt; later descendants may reuse the one-time receipt only after git ancestry verification. There is no perpetual seed-equality requirement on subsequent deployments. No production IDs, source URLs or catalogue contents belong in this receipt or Git.

`catalog:audit-final -- --commit=<SHA> [--manifest=<private DB/restore manifest>]` produces read-only count/hash audits from a fixed catalogue-table allowlist in one repeatable-read snapshot. It never prints row contents and no longer imports repository seeds or logo inventories. A private manifest comparison verifies the database snapshot only; the command always reports fileParityVerified=false because a DB hash cannot prove file preservation. The controller must attach independently reviewed file parity and restore evidence to the receipt. The existing catalog:verify is a separate historical diagnostic; generic seed writes remain restricted to disposable DBs.

DB-only packaging strips data/, public logos/offline snapshots, and seed/logo migration modules from the staging tree and rejects corresponding archive entries. Operational import/audit/activation commands remain packaged without live-file dependencies. Static fallback assets remain in ordinary releases until this gate passes; the new /logos/<slug>.png DB route preserves historical URLs after retirement. Full build/archive and route/public-file resolution smoke remain CI/controller checks.

## Remaining work before closing #210

Full file preservation parity is the immediate cutover blocker; backup/restore is controller-confirmed. Import shared identity/enrichment progress with `operational:import -- --key=artist-identities --input=<private reviewed state>` in preview, then add `--apply --expected-hash=<preview digest>` while workers are drained. Different existing DB progress and active leases are rejected; repeat apply is changed=0. Perform playlist drain, reconciliation, activation and timer switch; verify EN/DE/RU pages, URLs/logos, playlist IDs, offline cache, restart/timeouts and changed=0 repeated parse. New playlist creation/YouTube refresh and reviewed publication of enrichment candidates remain incomplete. Existing source inventory/seed files in Git still need retirement after preservation proof; no checklist was edited to conceal that acceptance gap.

Validation: `npm run test:final-cutover`, `npm run test:final-cutover-db` (disposable DB only), TypeScript, shell syntax, and diff checks. This worktree has no authorized Docker socket; DB integration runs in CI or the controller's disposable environment. No production command was invoked.
