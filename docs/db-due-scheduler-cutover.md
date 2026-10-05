# DB-due scheduler cutover (#210 phase 3)

This release is **OFF by default**. Merging/deploying only installs a root-owned switch, a dormant timer, and the persistent legacy|db-due mode under /var/lib/festival-radar-scheduler/mode. Do not enable the DB-due timer at merge. The release and DB credentials remain owned by www-data; the root wrapper serializes supported operations and is **not** a DB privilege boundary.

## Before a production switch (controller only)

1. Confirm /api/health/deployment/ reports the exact reviewed merge SHA, healthy status/database, and the release Quality/deploy checks succeeded. Confirm the manual one-source pilot and count-only due-health gates, including parser-key, expired lease, queue/outbox lag and error counts. Missing/invalid scheduler mode or heartbeat is unhealthy, not evidence of an empty queue.
2. Confirm the new festival-radar-db-due.timer is disabled/inactive and legacy ingestion is the only scheduled source fetch. The GitHub manual ingestion workflow is guarded inside the shared flock; it submits force:false and cannot bypass DB-due mode.
3. Review the mode switch and ensure a recovery operator is present. Never run the new switch in this PR or during a production deploy/source fetch.

## Switch (separate controller-owned production action)

The controller uses the existing constrained deploy-user sudo dispatcher: activate-release EXACT_DEPLOYED_SHA due-switch-db; it delegates to the installed root-owned db-due-scheduler with the exact SHA and db-due. The separate due-scheduler-health mode is read-only. It takes the deployment lock and common source-fetch lock, stops/disables both timers, stops and checks both legacy and due services, writes the persistent mode atomically, probes GET /api/ingestion/run/ for the exact SHA and legacyRouteInactive:true, then enables and verifies only the DB-due ten-minute timer. Any partial failure removes the mode gate and stops/disables both paths; it never automatically falls back to legacy fetching. A busy lock means inspect the running operation, not bypass the lock.

Verify independently afterwards: legacy timer/service inactive, DB-due timer enabled/active, exact-SHA deployment health still healthy, and GET /api/ingestion/run/ reports legacyRouteInactive:true with the exact SHA. An authorized legacy POST must return 409 without an ingestion run; this is stronger than the GET probe alone. No force flag can bypass the check made INSIDE the legacy source-fetch flock. Check root-owned db-due-scheduler health (missing/stale heartbeat and fetch/drain errors), plus existing due-health source/outbox lag, error, parser-binding and lease counts. Each tick claims at most one due source, then separately drains at most 100 outbox rows even on idle/fetch failure. The worker fetch budget is 1100s, drain budget 120s, and scheduler service timeout 1300s. The completed-tick heartbeat becomes stale after 40 minutes (ten minutes after inactivity plus one bounded long tick with margin); due-source and outbox lagged-over-hour counts remain separate DB health indicators. Treat error or missing/stale ticks as incidents; timer activation and the GET probe alone do not prove ingestion success.

## Inhibited mode / rollback

After any failed switch, verify BOTH timers and services off, the mode gate absent (legacy POST closed), and no stuck worker/lease. Do not enable the legacy timer by hand: use activate-release EXACT_DEPLOYED_SHA due-switch-legacy only after investigation and explicit rollback decision. It first stops and verifies both paths under both locks, atomically writes legacy, probes the active route and exact SHA, and only then enables legacy timer. Keep DB-due disabled. Deployments in DB-due or inhibited mode never automatically re-arm either ingestion timer; after deploy, repeat the exact-SHA gates and explicitly re-arm the intended mode. Other collection jobs are unaffected.

The root audit exposes only fixed status labels and numeric counts. Never publish source URLs, raw errors, credentials or event payloads.

## Read-only scheduler diagnostic

The manual **DB due scheduler read-only diagnostic** workflow has no inputs or
schedule. It runs only on `main`, behind the protected `production` environment
and shared `festival-radar-production` concurrency. It calls only the existing
constrained `activate-release GITHUB_SHA due-scheduler-health` grant. Production
must already have the reviewed root-owned wrapper installed and the exact SHA
active; a mismatch fails without a diagnostic. This candidate performs no
production action and leaves DB-due OFF by default.

The exact deployed commit is verified before producing the marker; the single validated marker includes existing mode/heartbeat
bits, each timer's enabled and active enums, and each service's `ActiveState`:
`inactive`, `active`, `failed`, `missing`, or `error`. Missing units and unavailable
or malformed queries emit fail-closed sentinels; neither `failed` nor `missing`
is `inactive`. No raw SSH output, logs, URLs or error details are relayed. This is
a state snapshot, not permission to switch or proof of ingestion success. Pilot
37343725370 stopped before preflight because legacy service was not inactive;
use the separate service enums to distinguish an active oneshot from a failed
one. Protected environment approval rules remain an external repository setting.

Legacy failure classification adds two fixed fields after `dueServiceActive`:
`legacyServiceResult` allows only `success`, `resources`, `protocol`, `timeout`,
`exit-code`, `signal`, `core-dump`, `watchdog`, `start-limit-hit`, `oom-kill`,
`exec-condition`, `unknown`, or `error`; `legacyServiceExitStatus` is an integer
0–255 only when `ExecMainCode=1` (`CLD_EXITED`), otherwise `unknown`. Signals are
never reported as numeric exit codes. Missing units yield `missing/unknown/unknown`
only with no optional service properties or exactly the canonical trio
`Result=success`, `ExecMainCode=0`, `ExecMainStatus=0`. Partial, duplicate or
noncanonical optional properties yield `error/error/error`;
transitional legacy states yield `unknown/unknown/unknown`; incomplete, duplicate,
malformed or unavailable snapshots yield `error/error/error`. An unrecognized
Result yields `unknown` and no numeric exit status. Unrun/default main-process
properties (`ExecMainCode=0`) also yield an unknown exit status. Transport is capped
at 4 KiB and the fixed-order marker at 2 KiB, with exactly one newline-terminated
record validated before display. The SHA is checked at the root gate, not relayed.

Local `org.freedesktop.systemd1(5)` and `systemd.exec(5)` document that Result
belongs to the last service run, whereas ExecMain fields can describe the current
or last main process. These retained properties may be reset/recycled; Result
can describe another service step, and `success` alone does not prove a run.
Numeric main exit status is therefore not necessarily the cause of the unit's
failure, including when a failed unit retains `Result=success`. No exit age or date is emitted: reboot, suspend and property recycling
prevent a reliable durable age from this snapshot. This diagnostic does not
establish when or why the observed legacy failure originally occurred.

## Explicit recovery with timers already paused (#210)

The separate manual **Explicit paused legacy failed-state recovery** workflow
calls `activate-release EXACT_SHA due-reset-legacy-failed`. It is restricted to
main/dispatch, protected production and the shared production concurrency group.
Deployment only installs this opt-in action; it never invokes it. The pilot is
unchanged and still refuses a failed legacy service before its DB preflight.

Recovery does **not** pause or rearm timers. Before an independently authorized
controller pause, the reported enabled/active legacy timer makes this action
ineligible. With both timers already disabled/inactive, the root-owned wrapper
holds the deployment and source-fetch locks continuously across all snapshots,
the single targeted reset and post-verification. It requires exact current SHA,
root-owned valid legacy mode, loaded units with no pending jobs or configuration
reload, the expected timer targets/persistence, and quiescent due tick, scheduler
and manual ingest services. The legacy oneshot must be fully failed with no
main/control PID or assigned control group, retained `Result=exit-code`, `ExecMainCode=1`, `ExecMainStatus=1`.
This selects the observed retained signature; it does not assert its cause/date.
It also requires oneshot/no-restart/control-group kill/no-remain-after-exit
settings, no success/failure/other outgoing triggers or uphold dependencies, and
only the expected incoming timer trigger. Missing, duplicate, malformed,
unavailable or unexpected properties refuse the reset.

Only `reset-failed` on the named legacy service is permitted. Afterwards all
quiet-state gates must still pass, with legacy inactive/dead and Result success;
the main exit pair may remain 1/1 or be cleared to 0/0. Output is one fixed enum:
`DB_DUE_LEGACY_RECOVERY status=reset|refused|reset-error|postcheck-error`, validated
against the remote exit status before display. Root/SHA/lock failures emit no
marker. A reset-error or postcheck-error means the reset may already have happened; do not
blindly retry. There is no timer start/stop/enable/disable, automatic rollback,
mode write, DB access, worker invocation, journal read or source mutation.

Safety assumes that independent privileged operators/configuration agents do
not start/rearm or modify units during the locked maintenance window. These
application locks serialize supported operations, not PID 1 or arbitrary root
commands, and are not a privilege boundary against the application account.
PID, empty ControlGroup and settled unit-state checks rely on the verified
control-group kill policy and systemd accounting. Any assigned cgroup is refused,
even if apparently empty; there is no untrusted path traversal or process census. Unsupported
systemd property representations fail closed and require controller review.
Local `systemctl(1)` documents that reset-failed also clears start-rate/restart
counters; `systemd.timer(5)` documents that Persistent calendar timers may catch
up when reactivated, subject to randomized delay. A failed unit is not proof
that its timer cannot start it again. Timer pause interrupts scheduled ingestion;
rearm can fetch immediately and is a separate authorized production decision.
This action leaves both timers disabled, preserves their persistent timestamps
and calendar settings, and never combines recovery with a pilot or preflight.
No pause, reset, pilot or rearm was performed for this candidate.
