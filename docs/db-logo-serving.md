# DB logo serving and UI fallback (#210)

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

`festivalLogoPath` resolves an exact reviewed slug through the pinned inventory,
then `databaseLogoPath` accepts only an exact allowlisted filename. Unknown slugs,
URLs, paths, case variations and the five intentional initials-only slugs return
null. `FestivalLogo` requests only `/api/logos/<filename>`, prefixed by
`NEXT_PUBLIC_BASE_PATH` when configured. Any HTTP, network or image decoding error
goes straight to initials. Duplicate/stale errors are ignored; there is no retry.
Changing slug or name remounts fresh state. Size changes retain the current state.

## Static fallback retirement (#210)

The 47 original binary files moved unchanged from `public/logos` to
`source-inputs/reviewed-logos`. No static logo URL mapping or public logo directory
remains. These source inputs are not HTTP assets and the endpoint never reads them.
The inventory JSON (filename, slug, MIME, byte size and SHA-256) and inventory digest
`99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456`
are unchanged. There are still 39 PNG and eight JPEG payloads, with five initials-only
festivals: bloodstock, brutal-assault, tolminator, pistoia-blues and polandrock.

Local and deployed manual import/audit/verify read the new non-public directory.
Release packaging explicitly copies it and verifies all 47 sizes/hashes and the
pinned digest; installation repeats this offline guard before activation or logo
unit changes. Import audit still fully decodes every pixel and rejects changed,
missing, extra or symlinked files. The fetch helper writes unreviewed candidates to
ignored `.logo-candidates/`, never to the pinned source directory or `public`.
The service worker no longer caches static logo URLs; its cache version is bumped
so activation removes the previous cache. DB API requests remain outside SW caching.
No auth, proxy, nginx or protected-image policy changes are included.

## Verification

- `npm run test:logo-serving`: exact allowlist, bytes/MIME, HEAD, ETag/304, error
  cache policy, UI terminal failure, prop reset, initials, unknown slugs, base path,
  and EN/DE/RU card/detail rendering covering all 47 logos plus five initials.
- `node --test tests/logo-source-inputs.test.mjs tests/service-worker.test.mjs`:
  immutable non-public source set, release guards, no static UI references, and SW.
- `node --import tsx --test tests/logo-import.test.ts`: full offline decode,
  unchanged digest, coverage and rejection of substituted/missing/extra sources.
- `npx playwright test tests/e2e/festival-logo.spec.mjs`: actual localized card and
  detail image errors (404, 503, network and decoding), immediate initials, exact
  47-request coverage and no static retry. Requires browser binaries and a migrated,
  backfilled disposable catalog, like the existing browser suite.
- `npm run test:logo-serving-db`: disposable-only integration test imports/verifies
  47 rows and tests actual Next HTTP bytes, cache/conditional behavior and missing
  bindings. Removed static and source-input HTTP paths must return 404. This test
  writes its disposable DB; never run against production or when apply is forbidden.

## Release gate and rollback

This implementation performs no deployment, production request, re-import or apply.
Production DB endpoint parity is **not established by local tests or the historical
47-row report**. Before deploying this retirement, independently verify exact
production DB byte/MIME/hash parity and the deployed endpoint through the real
reverse proxy: anonymous/authenticated GET/HEAD, both trailing-slash spellings,
JPEG MIME, ETag/304, cache/error behavior, configured base path and invalid/missing
routes. Confirm existing protected/public image behavior. If the API is unavailable
after retirement, users see initials; no static request masks the failure.

Keep the previous known-good release artifact for application rollback: it contains
its own static assets, UI fallback and matching importer path. Use the existing
reviewed release rollback procedure; do not copy source inputs back into the public
web root as an unreviewed hotfix. New releases retain all immutable source bytes for
manual preview/verify and separately authorized import or DB recovery. A rollback to
an older release can require the existing deployment-assets alignment procedure
before its manual logo dispatcher works; it fails closed on SHA mismatch. DB backup
restore remains a separate operator decision, never an automatic part of UI rollback.
See [reviewed-logo-import.md](reviewed-logo-import.md) for manual operation guards.

## Historical serving milestone (#250)

The earlier milestone retained a static retry. Its disposable DB tests verified
47 DB images; read-only production verify workflow
[37332030276](https://github.com/KirDE/festival-radar/actions/runs/37332030276)
reported `mode=verify status=ok sourceFiles=47 existing=47` on deployed SHA
`50402487d1fbb6a0d1fc5aa4526acaf664dc8e4f`. That release had not received the DB
serving route, so the historical report is not route parity evidence for this cutover.

## Retirement worktree checks (2026-10-05)

`npm run test:logo-serving` passed. Running focused UI, serving, import-unit,
production-audit-unit, apply-gate, source-input and SW tests with Node test isolation
disabled gave **42 passed / one existing sandbox skip / zero failures**. All 47
source files fully decoded with the unchanged inventory digest. `npm run typecheck`,
offline release source guard, shell syntax and `git diff --check` passed. The native
strip-types worker loaded its imports and rejected an invalid nonce before DB access.

`npm run build` compiled successfully but stopped because sandbox nested execution
returned empty TypeScript `--showConfig` output; a direct subprocess probe confirmed
`EPERM`. `npm run test:data` did not pass: an in-process diagnostic run gave 239/252
passing tests, with all 13 failures reproduced unchanged on base commit
`9d096123165cc315f4a980187d43d826e46bbe37` (nested-process `EPERM`/empty output).
The remaining eight selection/domain/source tests passed separately. Playwright
listed all 12 localized image-failure cases but execution could not start its dev
server. Full packaging was not completed because the build did not finish.
DB E2E suites were not run: they perform apply, which this implementation task
explicitly forbids. Controller/CI must complete build, full packaging and browser/DB
checks in an appropriate disposable environment before release; production parity
checks above remain a separate deployment gate.
