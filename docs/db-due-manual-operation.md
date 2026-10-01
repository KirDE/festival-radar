# DB due worker: manual-only foundation (#210)

This adds an **operator-triggered, fixed-mode systemd unit**, not a timer, recurring workflow, or scheduler switch. Deployment still enables the existing ingestion/notification timers; do not run this in production merely because the unit exists.

After a reviewed release is packaged, deployed and verified, an operator can inspect the installed unit and wrapper and explicitly start a single operation with the exact 40-character currently deployed release commit:

    sudo /usr/local/libexec/festival-radar/start-db-due <deployed-commit> health
    sudo /usr/local/libexec/festival-radar/start-db-due <deployed-commit> ingest
    sudo /usr/local/libexec/festival-radar/start-db-due <deployed-commit> drain

This is not a sudoers delegation: the supported trigger requires an existing privileged operator. It validates the mode, current symlink, release marker and deployment lock; the unit runs as www-data from the pinned release. **This wrapper is not a security boundary against the application user:** www-data owns the release and has the application DB credentials, so it can invoke the DB operations without the wrapper. This change provides an operator workflow and serialization with deployment, not database privilege isolation. Achieving that requires a separate DB role/ownership redesign. If release health fails, deployment restores the previous unit and wrapper (or removes them if absent), reloads systemd, and restores the previous release. Ingest processes at most one due source, drains at most 100 staged events on a separate invocation, and discards private worker artifacts after completion. The health invocation prints only numeric counts to the unit journal: due, due >1h, active leases, expired leases, enabled sources with failures, pending outbox events, events pending >1h, and unknown parser-key rows. No source strings, event payloads, error text or secrets should be printed. Unexpected errors are suppressed to fixed status messages (or exit codes).

For disposable PostgreSQL verification only, set a test/integration DATABASE_URL and run `npm run test:due-worker` (includes DB health E2E); never point it at production.

**Activation gate:** verify a deployed SHA, migrations and configuration backfill, take count-only health before and after a manual test, inspect lease recovery and outbox drain counts, and compare catalog/notifications with the legacy ingestion path. Keep the old scheduler active for now; do not run overlapping source fetches during a manual pilot. Only a separate reviewed change should switch the scheduler after idempotence and operational monitoring are proven. There is no automatic start and no production source operation in this change.
