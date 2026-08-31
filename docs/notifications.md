# Notifications runbook

Festival Radar records lineup additions/cancellations, date moves, ticket on-sale/low/sold-out transitions, and first timetable publication as part of a successful `ingest --publish` run. Keys contain the festival slug, edition year, event type and normalized changed value. Re-observing a change therefore returns the existing event and cannot create another delivery.

Authenticated users configure per-event, optionally per-festival preferences at `/api/notifications/preferences` and email, Telegram, or web-push endpoints at `/api/notifications/subscriptions`. Preferences support immediate, daily, and weekly delivery.

## Schedule and configuration

The ingestion workflow runs daily at 03:23 UTC. The notification workflow invokes the private dispatcher every ten minutes with GitHub concurrency set to one production run. Immediate notifications are due at creation, daily digests at the next 08:00 UTC, and weekly digests at the next Monday 08:00 UTC.

Production requires `APP_URL`, `INTERNAL_API_SECRET`, `DATABASE_URL`, and at least one of `EMAIL_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, or `WEB_PUSH_WEBHOOK_URL`. GitHub Actions receives only `APP_URL` and `INTERNAL_API_SECRET`; provider and database secrets stay in the deployed runtime. Missing configuration fails closed with a provider name but never a secret value.

## Claiming, retries, and observability

Each dispatcher atomically claims due rows with PostgreSQL `FOR UPDATE SKIP LOCKED` and a unique claim token before provider access. This prevents overlapping workers from selecting the same delivery. Email and web-push requests include the delivery ID as `Idempotency-Key` and in the JSON body. Successful rows become `SENT`; failures return to `PENDING` with capped exponential backoff and become `FAILED` after five attempts. Claims abandoned for more than 15 minutes are recoverable by a later run.

The workflow summary reports processed counts grouped by result (`sent`, `retry`, `failed`, `skipped`) without endpoints or credentials. Per-delivery attempts, timestamps and bounded provider status errors are retained in PostgreSQL. Provider request bodies contain only the configured destination and notification content.

## Recovery

1. Inspect the failed `Dispatch notifications` run and aggregate result, then inspect delivery status in PostgreSQL by ID. Never paste endpoint or secret columns into an issue.
2. Correct provider configuration or availability and manually dispatch the workflow. Pending deliveries keep their scheduled retry time; stale claims recover after 15 minutes.
3. To retry a terminal failure after the cause is fixed, set only that delivery to `PENDING`, clear `claimedAt`, `claimToken`, and `lastError`, and set `nextAttemptAt=NOW()`. Preserve `attempts` for audit history.
4. Do not reset a `SENT` delivery. If a provider timed out after accepting a request, verify the provider using the delivery ID/idempotency key before changing state.

The staging end-to-end test uses a disposable PostgreSQL database and local provider receiver to prove detected change → persisted event/delivery → claimed due delivery → one provider request. No production destination is contacted.
