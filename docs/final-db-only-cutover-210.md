# Final cutover candidate and release gates for #210

## Final Git retirement

All 13 `data/*` files, `lib/catalog/seed.ts`, and 47 `public/logos/*` assets are
removed. No live catalogue is copied into test fixtures. Parsers use fabricated
source configurations; DB and browser tests use a small synthetic catalogue and
generated plain-color images. `npm run test:seed` is guarded for local disposable
DBs, resets their test catalogue, and stays outside release archives.

One-off catalogue/source/logo imports, operational file import, file-vs-DB audit,
their dispatch workflows and deployment hooks are retired. DB source validation,
readers, due scheduling/leases, asset storage, publication, operational progress,
playlist workers/cutover and the read-only DB inventory audit remain. The ingestion
CLI requires `DATABASE_URL`, including with local HTML `--fixture`; generic parser
and fixture-runner tests still operate without a DB.

Release packaging no longer copies `data` or retired helpers. The existing
`DB_ONLY_RELEASE=true` receipt validation and stripping/archive absence checks
remain, including checks for stale build artifacts. Historical logo URLs continue
to resolve through the DB route; the UI falls back directly to initials.

This implementation performs no production migration, activation, timer change,
provider write, or issue closure. The sections below retain the historical cutover
record; commands for removed import/backfill/file-audit tools are obsolete.


Repository-only work against `05accea5c038b5eba91bc1e322530f4389c7508d`, left uncommitted. No production access, migrations, deployment or worker activation was performed here. The controller reports a fresh production backup and successful isolated restore; those facts still need to be bound to the protected cutover receipt. Full preservation parity between remaining files and the authoritative DB has **not** been verified. Standard deployment deliberately preserves those files until that specific blocker is resolved. This candidate does not complete #210.

## Commands and CI

`test:final-cutover`, `test:final-cutover-db`, `catalog:audit-final`, `operational:import`, `playlists:cutover`, and `playlists:worker` are defined in package.json. The `pretest:final-cutover-db` hook first validates a loopback disposable test/integration PostgreSQL URL, then generates Prisma and applies migrations. The E2E setup checks that both the generated client and PostgreSQL expose OperationalState and desiredPlan. Quality CI invokes the DB tests after its existing migration/reset steps and installs Python dependencies before the focused tests.

All operational commands are packaged and archive entries are checked. On an authorized server, an operator can run the packaged Node runtime with `--experimental-strip-types` and the protected application environment, as the application user. These commands do not require tsx in production. No new arbitrary-path SSH/sudo dispatcher or authenticated HTTP database runner is introduced. Production execution remains a controller/operator action; do not put DATABASE_URL on a command line or expose it in logs.

## Preserve legacy playlists until actual activation

The existing Tue/Fri collection timer and legacy provider path remain the default. The HTTP route continues its existing refresh behavior in that mode. An unset environment flag no longer disables work: `PLAYLIST_DB_WORKER_ENABLED` is not an activation mechanism. The route, collection dispatcher, direct DB-worker command, and activation command share the historical refresh.lock. The lock spans provider effects **and** the HTTP route's DB acknowledgement, and mode is read only after acquiring it. The internal route passes lock ownership to its child dispatcher to avoid nested locking. Do not invoke the legacy provider shell outside the locked dispatcher.

The new ten-minute playlists-db timer is installed dormant before cutover. Activation requires the exact DEPLOYED_COMMIT, a preview queue hash, no RUNNING rows, no retained owners/expiries, and no FAILED rows with missing retryAt. The command never bulk resets old jobs. Invalid mode records or DB errors fail closed rather than falling back to another consumer. The validated DB mode persists in OperationalState across deployments.

Subsequent installers read the durable `playlist-cutover` receipt after migrations. A valid completed receipt preserves DB scheduling across later release SHAs: the legacy playlist timer is disabled before release activation, and only the DB playlist timer is enabled after release health passes and the receipt is rechecked. A changed receipt between preflight and health fails closed. The original activation SHA and queue hash are historical evidence; deployments do not repeat activation or compare that hash with a changing live queue. A missing row permits legacy scheduling only when the legacy timer is enabled/active and the DB timer is disabled/inactive or missing, or when both timers are missing on a fresh install. Null/corrupt receipts, query failure, and absent receipts with contradictory or paused timer states disable both playlist timers and refuse deployment. Recover those cases through reviewed proof/state reconciliation rather than a silent legacy fallback. Playlist services are left alone so existing provider writes can finish under the shared lock. The independent DB-due ingestion timer still remains paused until its separate exact-SHA rearm.

Authorized rollout after review:

1. Stop/disable the legacy playlist timer and drain all old route/collection invocations. Reconcile legacy rows individually after provider read-back; do not infer success from age.
2. Run the packaged `scripts/playlist-cutover.ts` without --activate to preview. Inspect the sanitized count, blocked count and hash. An outstanding process either holds the shared lock or leaves a RUNNING row that prevents activation.
3. Run it with `--activate --confirm-legacy-drained --commit=<exact live SHA> --expected-queue-hash=<preview hash>`. The drain confirmation is an explicit operator attestation that old process trees and in-flight calls have ended; a lock or queue age alone cannot prove that after a crash. The command holds the same lock, locks queue rows, compares the exact hash and writes the durable activation receipt transactionally.
4. Enable `festival-radar-collection-playlists-db.timer`. Its dispatcher refuses to run before DB activation. Direct legacy invocations also select DB mode after activation, and all consumers are serialized by the same lock. Later deployments preserve only the DB playlist timer using the durable receipt; they also repair an accidentally enabled legacy timer without restoring the legacy provider path.

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

## Semantic file preservation audit (read-only)

`npm run catalog:audit-preservation -- --release-root=/absolute/live/release/app --identity-state=/private/identity-state.json --playlist-state=/private/playlist-status.json` compares a release's packaged files with `DATABASE_URL`. Supply the protected environment as the application user; do not paste connection strings into arguments or logs. The script is included in ordinary release archives and needs the release's generated Prisma client and Node 22+; it does not need tsx or a build. With the protected environment already loaded, the equivalent packaged command is:

```sh
/absolute/live/release/app/.runtime/node --experimental-strip-types \
  /absolute/live/release/app/scripts/audit-file-db-preservation.mjs \
  --release-root=/absolute/live/release/app \
  --identity-state=/private/identity-state.json \
  --playlist-state=/private/playlist-status.json
```

The default release root is the script's parent application directory. `--playlist-state` optionally selects the private shared playlist-status document instead of the packaged snapshot, including bindings absent from the package. Without that option, the packaged baseline remains in use and cannot prove preservation of additional shared state. A supplied unreadable/missing file reports `unavailable_file_input` for playlists; malformed JSON or entries report `invalid_file`. Neither case falls back to the packaged snapshot. The document must be a nonempty slug-keyed object with Spotify and/or YouTube Music HTTPS URLs, nonnegative integer artist/track counts, and an ISO timestamp with timezone. Unknown fields and absent/ambiguous current file-edition bindings are invalid. No private contents or paths are emitted. `--identity-state` is an optional private legacy schemaVersion=1 JSON document, not a repository fixture. Omitting it reports `unavailable_file_input` for identity progress and prevents a complete result. The packaged enrichment candidate document is compared with OperationalState, accepting direct imported, runtime `result`, and checkpoint payload shapes. DB enrichment cache entries are counted/hashed as DB-only content; there is no packaged cache baseline, so this audit does not prove preservation of an unprovided private historical cache. Lease owners, errors, scheduling and credential tables are never selected as evidence of semantic freshness.

One repeatable-read, explicitly read-only transaction reads all editions/artists (including archives), source bindings/configuration, operational payloads, playlists and logo bytes. Output consists only of fixed scope/category names, numeric counts and SHA-256 digests. It includes aggregate file/DB hashes and per-scope hashes. No natural keys, names, URLs, provider IDs, connection strings, payloads or exception text are emitted. Error output is a generic `audit_failed` category. File data is evaluated through the existing effective catalogue projection, with raw enrichment candidates and timetable coverage checked separately. Playlist files bind to their explicit current file edition; an archived or next-year DB playlist cannot satisfy that binding. Logo hashes are computed from both file and DB bytes, with inventory/size integrity checks.

`equal`, `newer_db_same`, `preserved_with_db_additions` and `db_only` do not require seed equality. `newer_db_changed` uses content observation times, never generic DB updatedAt; `db_owned_changed` identifies configuration/progress changes without claiming they are newer. Both require private review. Missing rows, changed provider/logo bindings, duplicate keys, corrupt assets, inconsistent enabled source bindings and unavailable inputs remain unresolved. Newer content never excuses a missing row or silently authorizes a replacement playlist/identity binding. Lineup order, cancellation status, timetable metadata/artist linkage, provenance, URLs and artist profile fields participate in comparison. Added DB lineup members may shift numeric positions when every original member retains its relative order; reordering or cancellation still requires review.

Exit codes: 0 means the supplied file inputs are preserved by this comparison; 2 means unresolved categories or reviewed-difference work remains; 1 means the audit could not complete. A zero exit is **not** a cutover receipt, backup/restore verification, playlist activation or #210 completion. DB-owned changes still need reconciliation with private historical evidence; this command never imports, modifies files/DB, calls providers, or retires fallbacks. A stripped DB-only archive lacks the required file baseline and must be compared using the preserved pre-retirement release instead.

Validation commands: `npm run test:preservation`, `npm run test:final-cutover`, and `node_modules/.bin/tsc --noEmit --incremental false`. The semantic tests use synthetic in-memory data, check all comparison scopes and enforce the read-only query boundary. A local file-only smoke reads the current package without a DB. Actual PostgreSQL execution and production preservation remain unverified here.
