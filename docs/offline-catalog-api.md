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

This adds no client activation. The service worker, static JSON, navigation,
scheduled operations and schema are unchanged.

Run unit checks with `node --import tsx --test tests/offline-catalog.test.mjs`.
Run migration/seed parity and rollback-only DB mutation checks with
`node --import tsx --test tests/offline-catalog.e2e.test.ts` against an **already
migrated and backfilled local disposable test/integration database**. The test
does not reseed or clear the DB and refuses remote/ambiguous DB URLs.
