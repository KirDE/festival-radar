# Additive DB logo serving (#210)

`GET` and `HEAD /api/logos/<reviewed-filename>` read the festival binding and blob
from PostgreSQL. With the current inventory, filenames are `<slug>.png`; actual
MIME comes from the reviewed stored content (39 PNG, eight JPEG). Only the exact
47 filenames in `data/reviewed-logo-inventory.json` are accepted. This endpoint
does not accept URLs, filesystem paths, arbitrary slugs or blob hashes, and never
reads files or fetches remote content at request time.

Every response verifies the binding hash, MIME, size and bytes against the pinned
inventory before serving or evaluating a conditional request. A missing binding
or invalid filename returns an empty `404`; database failure or an unreviewed or
corrupt binding returns an empty `503`. Both use `Cache-Control: no-store` and
omit ETag. Database exception text is never exposed. Successful responses set the
actual MIME, `nosniff`, a quoted SHA-256 ETag and
`Cache-Control: public, max-age=0, must-revalidate`. Filename URLs are not immutable.
`If-None-Match` accepts strong/weak tags, lists and `*`, returning bodyless `304`
with the same ETag/cache policy. HEAD returns the GET headers without the body.

`databaseLogoPath` in `data/logo-serving.ts` maps only exact existing reviewed
`/logos/<filename>` references to `/api/logos/<filename>`. It returns null for
unreviewed paths, external URLs and the five initials fallbacks. It is an opt-in
integration seam for the next cutover; the current UI still uses
`festivalLogoPath`, and all `public/logos` files remain available. No page auth,
proxy, nginx, protected-image or public-image rules change in this milestone.
The new endpoint intentionally exposes only reviewed public festival logos.

## Verification

- `npm run test:logo-serving`: focused path, mapping, bytes/MIME, conditional,
  HEAD, cache, missing, corruption and database-error tests without a database.
- `npm run test:logo-serving-db`: requires a **local disposable** PostgreSQL
  database (using the existing strict test guard), migrations and catalog backfill.
  It audits and imports/verifies all 47 rows, starts a loopback Next dev server,
  tests actual HTTP routing and all 47 images, conditional requests, invalid paths,
  missing binding and the surviving static fallback. It temporarily removes one
  binding and restores it in `finally`. Never run against production.
- Quality CI runs both after the existing disposable logo-import tests.

The reported 47 production rows are not route-parity evidence. Before changing
UI references, independently verify production DB byte/MIME/hash parity and test
the deployed endpoint through the real reverse proxy: anonymous and authenticated
GET/HEAD, both trailing-slash spellings, JPEG MIME, ETag/304, cache/error behavior,
base-path handling if configured, and invalid/missing routes. Confirm existing
protected/public image behavior and static rollback URLs. Keep `/public/logos`
until those checks pass. A future logo replacement needs an explicitly reviewed
inventory update; this route fails closed for manually changed bindings.

## Local milestone results

Independently verified on this branch: focused serving tests (5/5), `npm run typecheck`,
`npm run build`, and `npm run test:data` (248+4+4) passed. A fresh
isolated Docker PostgreSQL 16 database was migrated and backfilled; the DB E2E
imported/verified 47 reviewed logos and served all 47 through actual Next HTTP,
including MIME, bytes, ETag/304, invalid paths and missing-binding/static-fallback
behavior. The revised E2E test passed again after a readiness-gated fresh restore;
the disposable container was removed.

Read-only production verify workflow [37332030276](https://github.com/KirDE/festival-radar/actions/runs/37332030276)
reported `mode=verify status=ok sourceFiles=47 existing=47` on exact deployed
SHA `50402487d1fbb6a0d1fc5aa4526acaf664dc8e4f`. Production has not
received this route; production route parity remains a later release gate before
changing UI references or removing static fallback.
