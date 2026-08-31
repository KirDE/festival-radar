# Ingestion source health

Scheduled ingestion runs inside production and persists attempts, candidates, evidence, diffs and per-source last-success state in PostgreSQL. Successful sources are always retained even when another source fails.

HTTP 403, 408, 425, 429 and 5xx responses, timeouts and network failures receive at most three attempts with capped exponential backoff. A run with failures below `INGESTION_FAILURE_THRESHOLD` (default `3`) is reported as `degraded` and emits an Actions warning; reaching the threshold is `failed` and exits with code 2. The threshold can also be set with `--failure-threshold=N`.

Each `FestivalSource` may define `headers` and a separately approved `fetchUrl`. This permits an official machine-readable feed without changing the public evidence URL. Never add authentication cookies or secrets to the source inventory.

The per-run `summary.json` is also the adapter coverage artifact. Every source reports its configured `extractionPath`, any manual-review reason, extracted evidence fields, and the persisted `lastSuccessfulExtraction`. A successful HTTP check without supported evidence does not advance that extraction timestamp; PostgreSQL evidence rows provide the durable read-back source.

Sources intentionally configured as `manual_review` run weekly, carry an explicit reason in the source inventory and diagnostics, and cannot silently fall back to a misleading generic parser. The current official-page fixtures are deliberately reduced to the exact trusted or missing markers; they contain no third-party scripts or tracking data.

## Restricted sources checked 2026-08-30

- Pol'and'Rock: the official page returned HTTP 200 with the documented bot headers.
- 2000trees: the official page remained HTTP 403 with bot and browser headers. Its official WordPress feed at `https://www.twothousandtreesfestival.co.uk/feed/` returned HTTP 200 and is the explicit alternative official feed for future adapter work. Until that adapter is approved, the normal source remains enabled and degraded health is persisted rather than silently treating it as current.
- MetalDays: the official page, feed, WordPress API, robots file and sitemaps all returned the same HTTP 403 response with bot and browser headers. No machine-readable official alternative was discoverable. The explicit fallback is manual review of the official site in a browser; automation keeps the source failure visible and escalates after the configured threshold.

Diagnostic and summary artifacts contain no credentials and are retained for 30 days.
