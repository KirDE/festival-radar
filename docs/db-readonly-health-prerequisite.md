# Dormant read-only health prerequisite (issue #210)

`lib/ingestion/readonly-health.ts` is a local diagnostic and fixed-count alert
decision prerequisite. It is **not a production alert**. Nothing invokes it from
a deployment, workflow, scheduler, route or notification sender. The existing
protected manual due-health wrapper and its eight-count serialized contract are
unchanged. Activation and notification delivery require separate review.

For a local diagnostic, supply an explicit Prisma client and a valid Date to
`readonlyDueHealth(client, now)`. Use a read-only database role where available.
The function only calls `count` and the existing parser-key `groupBy` through
`dueWorkerHealth`; it never claims jobs, changes rows, invokes a worker, acquires
locks or calls external services. It does not create a global client. The caller
owns client lifecycle. No DB configuration is read by this module.

The exact flat output contains only nonnegative safe integer counts:

| Fields | Meaning |
| --- | --- |
| `due`, `queueLaggedOverHour`, `active`, `expired`, `error` | Existing dueWorkerHealth semantics: eligible due sources, due sources at least one hour late, active/expired owned source leases, enabled sources with consecutive failures. |
| `outboxPending`, `outboxLaggedOverHour`, `unknownParserKeys` | Undelivered events, undelivered events at least one hour old, enabled source rows with null/unknown/mismatched parser bindings. |
| `playlistPending`, `playlistRunning`, `playlistSucceeded`, `playlistFailed` | Durable queue rows in each of the four statuses, including legacy rows. |
| `playlistLaggedOverHour` | PENDING, RUNNING or FAILED rows requested at least one hour ago; SUCCEEDED rows are excluded. Includes deferred retries and legacy blocked rows. |
| `playlistExpired` | RUNNING rows with a non-null owner and lease expiry at or before the diagnostic clock. |
| `playlistUnleasedRunning` | RUNNING rows missing an owner or expiry, including partially populated leases. |
| `playlistRetryDue`, `playlistDormantFailed` | FAILED rows with retryAt at or before the clock, or with null retryAt, respectively. Future retries count only in playlistFailed and possibly lag. |

All count results are validated, including parser-group counts for valid keys,
and the parser aggregate is checked for overflow. Invalid counts, clock/input or
database failures throw only `Read-only health unavailable`, without the raw
error or cause. A failure is unavailable health, never an empty queue or a safe
decision. No source URL, ID, parser string, error, timestamp or secret is returned.

`validateReadonlyHealthCounts(input)` is a pure exact-schema boundary. It rejects
missing/extra keys, symbols, accessors, non-plain objects, coercible strings,
fractions, negative values (including negative zero), nonfinite numbers and unsafe
integers. It returns a fresh count-only object without serializing input.

`readonlyHealthAlert(input)` validates that same schema and returns the integer
`1` if **any** of `queueLaggedOverHour`, `expired`, `error`,
`outboxLaggedOverHour`, `unknownParserKeys`, `playlistLaggedOverHour`,
`playlistExpired`, `playlistUnleasedRunning` or `playlistFailed` is **>= 1**;
otherwise it returns `0`. Thresholds are fixed in code, with no configurable input
or environment overrides. Ordinary due/pending/active/running/succeeded totals
alone do not request an alert. The function has no sending behavior.

These are independent aggregate reads, not a transactionally consistent snapshot
or a claimability calculation. A moving queue can change between counts. Zero
counts or a zero decision do not prove scheduler heartbeat health, playlist
side-effect fencing or safe cutover. Legacy unleased RUNNING and FAILED-without-
retry rows remain untouched; follow `db-playlist-queue-cutover.md` before any
future worker activation.

Targeted verification: `node --import tsx --test tests/readonly-health.test.mjs`.
This test is also discovered by `npm run test:data`.
