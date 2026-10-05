# DB offline catalogue prerequisite (#210 phase 5)

`GET /api/offline/catalog` is public and always reads current 2027 editions
from the database. It preserves the legacy `schemaVersion: 1` envelope and
festival brief (`slug`, `name`, dates, timetable), with all current festivals
rather than the static sample. Missing dates are `null`; absent timetables are
empty arrays. Timetable entries expose only date, stage, start, artist, timeZone
(UTC fallback) and scheduled/cancelled status. No source URLs, observation times,
internal IDs, profiles, playlists or account data are exposed.

`dataVersion` identifies the legacy format, not freshness. `generatedAt` is
`null`: this live deterministic representation has no build timestamp.
`timetableStatus` is `published` if any included festival has timetable entries,
otherwise `not-published`; this does not claim every timetable is complete.

Festivals and timetable entries have deterministic ordering. `X-Catalog-Revision`
is SHA-256 of the exact UTF-8 JSON response bytes; the strong `ETag` quotes that
same digest. Neither source timestamps nor deployment commits contribute to it.
Successful responses require revalidation (`public, max-age=0, must-revalidate,
no-transform`). Matching `If-None-Match` (including weak tags, lists and `*`)
returns a bodyless 304 only after a successful fresh DB read. Missing current
2027 editions or DB errors return a bodyless 503 with `Cache-Control: no-store`
and no validator. There is no file fallback or retained process snapshot.

## Revision-aware client cache (#210 phase 5)

The public service worker now warms this endpoint during installation (best
effort) and refreshes it when the app opens after worker readiness. The offline
page reads the same endpoint and renders festival briefs and timetable entries
as text. With Next's `trailingSlash` configuration, network requests use
`/api/offline/catalog/`; the worker accepts only that exact path and its bare
alias, with no query string, and stores one canonical cache entry.

Requests omit credentials and do not forward caller headers. Requests with
explicit Authorization/Cookie headers are not intercepted; other APIs remain
excluded. Only successful JSON with the expected envelope, an explicit public
cache directive and matching revision/ETag headers is saved. Private, no-store,
cookie-setting, auth-varying and redirected responses cannot populate the cache.

Each read tries the network. `If-None-Match` is sent only with a usable saved
body. A matching public 304 returns that body as a 200 and renews its retention
stamp. An unexpected/mismatched 304 retries once without a validator; a second
304 becomes an uncacheable 502. A changed 200 replaces both body and validator.
Network failures can return only a previously validated public body, subject to
the existing seven-day retention limit; HTTP errors are returned as errors.
Cache Storage failures do not prevent a successful initial network read.

The legacy static JSON remains precached, but is not substituted for DB JSON.
DB failure does not block shell installation. A first offline visit without a
saved DB response shows an explicit unavailable message. Navigation failure uses
only this worker's public offline shell, never arbitrary caches or account pages.
No timers, live Git reads, DB/API changes or scheduled operations are added.

Client checks: `node --test tests/service-worker.test.mjs tests/offline-page.test.mjs`.

Run unit checks with `node --import tsx --test tests/offline-catalog.test.mjs`.
Run migration/seed parity and rollback-only DB mutation checks with
`node --import tsx --test tests/offline-catalog.e2e.test.ts` against an **already
migrated and backfilled local disposable test/integration database**. The test
does not reseed or clear the DB and refuses remote/ambiguous DB URLs.
