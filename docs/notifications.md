# Notifications

Festival Radar records lineup, date, ticket, and timetable changes through `POST /api/notifications/events`. The ingestion worker supplies a stable `dedupeKey`, so duplicate observations never create duplicate deliveries.

Authenticated users configure per-event, optionally per-festival preferences at `/api/notifications/preferences` and email, Telegram, or web-push endpoints at `/api/notifications/subscriptions`. Preferences support immediate, daily, and weekly delivery.

An internal scheduler calls `/api/notifications/dispatch` with `INTERNAL_API_SECRET`. Failed providers are retried with exponential backoff up to five attempts. Email and web push use provider-neutral HTTPS webhooks; Telegram uses the Bot API. Provider secrets remain server-side.
