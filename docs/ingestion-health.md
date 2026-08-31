# Ingestion source health

Scheduled ingestion stores `source-state.json` in a cross-run Actions cache. Each source records its last attempt, last successful check, most recent failure and consecutive failure count. Successful sources are always retained even when another source fails.

HTTP 403, 408, 425, 429 and 5xx responses, timeouts and network failures receive at most three attempts with capped exponential backoff. A run with failures below `INGESTION_FAILURE_THRESHOLD` (default `3`) is reported as `degraded` and emits an Actions warning; reaching the threshold is `failed` and exits with code 2. The threshold can also be set with `--failure-threshold=N`.

Each `FestivalSource` may define `headers` and a separately approved `fetchUrl`. This permits an official machine-readable feed without changing the public evidence URL. Never add authentication cookies or secrets to the source inventory.

## Restricted sources checked 2026-08-30

- Pol'and'Rock: the official page returned HTTP 200 with the documented bot headers.
- 2000trees: the official page remained HTTP 403 with bot and browser headers. Its official WordPress feed at `https://www.twothousandtreesfestival.co.uk/feed/` returned HTTP 200 and is the explicit alternative official feed for future adapter work. Until that adapter is approved, the normal source remains enabled and degraded health is persisted rather than silently treating it as current.
- MetalDays: the official page, feed, WordPress API, robots file and sitemaps all returned the same HTTP 403 response with bot and browser headers. No machine-readable official alternative was discoverable. The explicit fallback is manual review of the official site in a browser; automation keeps the source failure visible and escalates after the configured threshold.

Diagnostic and summary artifacts contain no credentials and are retained for 30 days.
