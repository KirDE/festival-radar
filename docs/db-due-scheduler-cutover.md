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
