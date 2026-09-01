# Festival Radar product status

Last verified: 2026-09-01 (production at `https://festivals.kir-it.de`, exact
commit `fbf91dd0aad1e494e33ce8c5c5151ecee686995b`).

This document is the product-function inventory requested at the end of the
2026 milestone. It describes the deployed behavior, not merely code that has
passed CI. The gap list is based on production acceptance and regression
testing of every pull request merged on 2026-08-30, every milestone pull
request from #73 through #88, and the production remediations through PR #167.
The later concept-gap pull requests listed below are verified but unmerged;
none of their changes are described as deployed or production-accepted.

## Original concept

Festival Radar is a multilingual public discovery and planning service for
European rock and metal festivals. The concept combines trustworthy festival
facts and provenance, search and comparison, personal planning, streaming and
setlist discovery, timely change notifications, community submissions, and an
editorial operating system that can safely keep the catalog current.

The intended trust model is as important as the feature list: facts are tied
to official sources, ambiguous or destructive changes require review, user
data is private and access-controlled, automation is durable and auditable,
and deploys can be verified and rolled back.

## Deployed functions

### Discover festivals and artists

- Browse 50 current European festivals as cards, map markers, country pages,
  month pages, artist pages, festival detail pages, and edition/year pages.
- Filter by text, month, genre, country, origin and travel distance; compare
  selected festivals side by side.
- Read dates, location, genres, lineup, ticket state and official links. Ticket
  availability distinguishes available, unavailable and unknown states.
- Browse an immutable 2026 archive and distinct 2027/2028 edition records.
  Unknown edition URLs fail closed instead of inventing data.
- Use canonical URLs, reciprocal language alternates, sitemap entries and
  truthful `MusicEvent` structured data.

### Plan and share

- Save favorites, collections, filters and plans locally while signed out.
- Register or sign in to synchronize those documents across devices with
  revision-based conflict detection.
- Compare festivals, use the calendar/map views, export the full or per-event
  plan to iCalendar, and create expiring public share links.
- Generate a playlist for a selection, with an explicit local export fallback
  when a connected provider is unavailable.

### Music discovery

- Show artist pages, setlist-derived listening context, Spotify links and
  playlist publication status without fabricating unavailable provider data.
- Connect Spotify through OAuth, import owned/followed playlists and retain an
  encrypted refresh token.
- Build season-scoped Spotify playlists and transfer reviewed results to
  YouTube Music through operator workflows.
- Resolve artist identities and retain reviewed enrichment/provenance data.

### Accounts, submissions and notifications

- Use opaque, hashed, expiring database sessions and server-side role checks.
- Accept normalized festival submissions with validation, honeypot and
  deduplication controls, returning a non-guessable public reference only
  after persistence succeeds.
- Let authorized editors approve or reject submissions with append-only audit
  history.
- Store notification preferences and channel subscriptions, derive events from
  ingestion changes, claim deliveries safely and dispatch authenticated jobs.
- Dispatch notifications from a production-owned systemd timer every ten
  minutes. PRs [#139](https://github.com/KirDE/festival-radar/pull/139),
  [#155](https://github.com/KirDE/festival-radar/pull/155) and
  [#157](https://github.com/KirDE/festival-radar/pull/157) installed and made
  the timer compatible with the production curl version.

### Languages, accessibility and offline use

- Serve English, German and Russian route trees with matching document
  language, metadata, language switching, manifests and localized public
  content.
- Provide keyboard focus styles, skip links, landmarks, live status regions
  and a localized admin shell.
- Install as a PWA, cache an allowlisted public shell, keep account/API traffic
  out of Cache Storage, and show a navigation-only offline fallback.

### Editorial and operations

- Ingest official festival sources on adaptive schedules, normalize and diff
  observations, persist attempts/candidates/evidence in PostgreSQL and keep
  provenance and change history.
- Auto-publish only safe additive changes. Deletions, cancellations, date
  moves, conflicts and weak lineup observations require review.
- Expose role-protected admin views for submissions, content changes, drafts,
  source refreshes, assets, diagnostics and audit records.
- Deploy an exact main commit through a constrained deployment identity,
  migrate PostgreSQL, switch releases atomically, health-check the database and
  restore the previous release/environment on failure.
- Collect minimized daily path/locale analytics without visitor identifiers;
  honor Do Not Track and Global Privacy Control and protect aggregate read-back
  with an operator secret.

## Current production evidence

- `/`, `/planner/` and `/festivals/wacken-open-air/` returned HTTP 200 on the
  verified commit.
- `/api/health/deployment/` returned HTTP 200, the exact commit above and
  `database: ok`.
- `/api/health/notification-scheduler/` returned HTTP 200 with `ok: true`; the
  latest run completed successfully and the health age was under two minutes
  at verification time.
- Analytics retention is owned by an enabled, active production systemd timer.
  Two consecutive idempotent production runs succeeded, the protected endpoint
  failed closed with JSON 401 for an invalid token, and the non-secret state
  file recorded `ok: true`.
- The Admin Console preserves `/admin/` while switching English, German and
  Russian, renders the authenticated `ADMIN` role truthfully and fits all six
  sections at 320, 375 and 390 px without horizontal overflow. The protected
  admin allowlist is also preserved across production deploys.

## Concept-gap remediation status

The gaps below still exist in production at the verified commit. Each linked
pull request is open, non-draft, mergeable and exact-head CI-green, with no
reviews, comments or unresolved review threads as of 2026-09-01. This is
implementation evidence, not deployment evidence: every change remains
subject to review, merge, deployment and the stated production acceptance.

| Production gap | Implemented in a verified, unmerged PR | What remains blocked |
| --- | --- | --- |
| [#168](https://github.com/KirDE/festival-radar/issues/168): the Admin Console allowlist can grant access to a persisted `USER`. | [PR #170](https://github.com/KirDE/festival-radar/pull/170) at `5ccd6ec2a03286ca022e0a8dfecffe2b5123178c` requires both the allowlist and an `EDITOR`/`ADMIN` role, makes refresh `ADMIN`-only and tests the role matrix. | Review, merge, deploy and full-proxy role acceptance. |
| [#126](https://github.com/KirDE/festival-radar/issues/126): cookie-authenticated mutations do not consistently reject forged origins. | [PR #143](https://github.com/KirDE/festival-radar/pull/143) at `20517a614b968c3da103b35357929aab5c7e87a3` centralizes an exact same-origin guard across 13 browser mutation routes while preserving bearer-only service boundaries. | Review, merge, deploy and proxy tests proving forged mutations leave sessions and data unchanged. |
| [#40](https://github.com/KirDE/festival-radar/issues/40): the scheduler is healthy but no production channel can deliver. | [PR #171](https://github.com/KirDE/festival-radar/pull/171) at `b3c411203bf36e00e64c7598f019c975df4f39df` wires optional protected provider settings, separates scheduler/provider/delivery health and blocks unavailable channels in the UI; provider-stub delivery passed. | **External blocker:** no dedicated production notification-provider credential is configured. Real delivery acceptance cannot run until one is supplied; unrelated bot credentials must not be reused. |
| [#172](https://github.com/KirDE/festival-radar/issues/172): email notification identity is asserted but not verified. | [PR #173](https://github.com/KirDE/festival-radar/pull/173) at `4dcbad65c07c333111fa576c5b46f295226e3618` adds hashed, expiring, single-use verification tokens and fails closed at preference, fan-out and dispatch boundaries. | Review, merge and deploy; end-to-end production acceptance also depends on a configured email provider. |
| [#169](https://github.com/KirDE/festival-radar/issues/169): proxy access logs retain analytics page-view request metadata. | [PR #174](https://github.com/KirDE/festival-radar/pull/174) at `0409211cc25462a475fe7289922ecb4a798a216f` installs exact HTTP/HTTPS nginx locations that suppress only analytics access logs and forwarded client IPs. | Review, merge, deploy and controlled log-count acceptance for analytics and an ordinary-route control. |
| [#22](https://github.com/KirDE/festival-radar/issues/22): two catalogue sources were stuck in repeated HTTP 403 failures. | [PR #176](https://github.com/KirDE/festival-radar/pull/176) at `bc2374c5282d7ec35fc1d5512f568d4f67e1aa99` restores 2000trees from its real official source and retires defunct MetalDays from scheduled retries; live official-source extraction passed. | Review, merge, deploy and scheduled-run read-back; the public MetalDays replacement is handled separately by #175. |
| [#175](https://github.com/KirDE/festival-radar/issues/175): defunct MetalDays is still presented as a speculative 2027 festival. | [PR #177](https://github.com/KirDE/festival-radar/pull/177) at `925f4d67d87919d8a6238931ee5140c6d794fd47` replaces it with officially evidenced Tolminator 2027 across catalogue, source, route, playlist and sitemap data; local route and live-source acceptance passed. | Review, merge, deploy and public route/sitemap acceptance. |
| [#125](https://github.com/KirDE/festival-radar/issues/125): scheduled data collection still runs in GitHub Actions. | [PR #158](https://github.com/KirDE/festival-radar/pull/158) at `f6d9e7e0cdba47d4adeaf4268eb9dbb30943a650` moves ingestion, identity resolution, playlists and source monitoring to persistent production systemd timers, leaving workflows manual-only. | Review, merge, deploy and timer/provider-secret health acceptance. |
| [#133](https://github.com/KirDE/festival-radar/issues/133): a valid slug-scoped ingestion run is checked against the full-catalogue contract. | [PR #144](https://github.com/KirDE/festival-radar/pull/144) at `c5d84f8e2a23dfe46add90a31d5df293dfbff042` gives scoped and unscoped runs distinct durable assertions; an exact-head scoped Pinkpop workflow passed. | Review and merge; the implementation is not part of the deployed `main` commit. |
| [#124](https://github.com/KirDE/festival-radar/issues/124): the mobile map popup is clipped and the planner overflows. | [PR #151](https://github.com/KirDE/festival-radar/pull/151) at `432c06915ae6bb17e89b4b2653e1a249e62064c9` fixes popup containing-block geometry and covers edge markers at 320, 375 and 390 px plus desktop. | Review, merge, deploy and mobile/desktop browser acceptance. |
| [#128](https://github.com/KirDE/festival-radar/issues/128): localized notification choices submit non-canonical enums and the authenticated view overflows. | [PR #150](https://github.com/KirDE/festival-radar/pull/150) at `8332b94a6a0b10e3db4de1685db9ff19614242c0` separates enum values from labels, localizes the workflow and removes 320–390 px overflow. | Review, merge, deploy and authenticated production persistence/layout acceptance. |
| [#130](https://github.com/KirDE/festival-radar/issues/130): planner and navigation copy remains partly English on German/Russian routes. | [PR #152](https://github.com/KirDE/festival-radar/pull/152) at `44c9c3ef9866078701c9f562ce3cf6e7d40d641b` localizes navigation, planner controls, statuses and empty states across EN/DE/RU. | Review, merge, deploy and locale-route browser acceptance. |
| [#131](https://github.com/KirDE/festival-radar/issues/131): first offline use deletes precached resources that lack timestamps. | [PR #145](https://github.com/KirDE/festival-radar/pull/145) at `59edc3e50c0307c19395c2ee67fecc47b337c493` timestamps precache responses and exercises offline payload, manifest and icon reads. | Review, merge, deploy and fresh-profile offline acceptance. |
| [#132](https://github.com/KirDE/festival-radar/issues/132): Wacken 2028 is published without positive edition-specific evidence. | [PR #146](https://github.com/KirDE/festival-radar/pull/146) at `bb61b28ae535c027986f23e7b6c4ee58f2a2f93b` removes the unsupported edition and rejects generic, wrong-year, off-domain or absence-only evidence. | Review, merge, deploy and archive/route/sitemap acceptance. |
| [#135](https://github.com/KirDE/festival-radar/issues/135): curated artist values can retain provenance from a discarded generated identity. | [PR #148](https://github.com/KirDE/festival-radar/pull/148) at `9875058680922ee2230cda0124dee40724c3ee5f` discards mismatched field and identity provenance while retaining compatible partial enrichment. | Review, merge, deploy and enriched/partial artist-page acceptance. |
| [#136](https://github.com/KirDE/festival-radar/issues/136): artist routes lose locale, making translated enrichment unreachable. | [PR #153](https://github.com/KirDE/festival-radar/pull/153) at `ab289d141f32caa195d03914fb69d7d0cfabfd2a` adds locale-aware artist/festival detail routes and same-detail language switching. | Review, merge, deploy and EN/DE/RU browser acceptance for enriched and partial profiles. |
| [#129](https://github.com/KirDE/festival-radar/issues/129): the Admin Console lacks a persisted playlist editor and real parser-log read-back. | [PR #149](https://github.com/KirDE/festival-radar/pull/149) at `909daaa29e1e8152ea3132dfc7e0974871f71c00` adds playlist CRUD/review persistence and an authenticated endpoint that renders the stored parser log. | Review, merge, deploy and reversible operator-flow acceptance. |
| [#134](https://github.com/KirDE/festival-radar/issues/134): YouTube Music production refresh fails. | [PR #147](https://github.com/KirDE/festival-radar/pull/147) at `bd91472072bc519cc982c409357319e30faa3056` separates public search from authenticated Data API writes, adds safe phase diagnostics, caps resume writes and fails closed. Code is complete and exact-head CI is green. | **External blocker:** live refresh currently returns `403 quotaExceeded`. Successful write/read-back acceptance must wait for the YouTube Data API daily quota reset or a quota increase. |
| [#97](https://github.com/KirDE/festival-radar/issues/97): the release installer assumes system npm. | [PR #141](https://github.com/KirDE/festival-radar/pull/141) at `91f203b2628640682c976f60d3074b7c634a387c` bundles pinned npm with Node 22 and proves installation with system npm absent. | Review, merge, deploy and installer acceptance on the production host. |
| [#98](https://github.com/KirDE/festival-radar/issues/98): deployment configures only one Plesk proxy vhost variant. | [PR #142](https://github.com/KirDE/festival-radar/pull/142) at `d60929c3be04da092cb5fec6bed381aaae2a7d2f` generates equivalent HTTP and HTTPS Plesk proxy includes from one template. | Review, merge, deploy and external HTTPS/deployment-marker acceptance. |

All 20 implementation PRs remain unmerged. Issue
[#159](https://github.com/KirDE/festival-radar/issues/159) tracks this inventory
refresh itself and does not change that production boundary.

Two acceptance areas remain evidence-limited rather than confirmed broken:

- A real aggregate playlist could not be independently reproduced from the
  available signed-out production session after PR #65.
- The connected Spotify OAuth/import/last-sync path could not be exercised with
  a disposable provider account after PR #66. Authentication, database sync,
  sharing, conflict handling and disconnected behavior were verified.

## Verification and maintenance

- Treat the deployment marker, CI and HTTP success as prerequisites, not proof
  of feature acceptance. Test the concrete user or operator behavior after
  deployment and test adjacent behavior touched by the diff.
- Keep issue links above current. Remove a gap only after its acceptance
  criteria pass in production (or an explicitly justified production-equivalent
  environment for destructive/failure-only behavior).
- For mutable probes, use reversible synthetic data and clean it up. Record any
  unavoidable retained test record.
- Never infer that a closed implementation issue means the deployed behavior
  passed. The production audit result is authoritative.
