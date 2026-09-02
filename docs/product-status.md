# Festival Radar product status

Last verified: 2026-09-02 (production at `https://festivals.kir-it.de`, exact
commit `95d710b579d17b575a441be8d6fa95e6fe65df08`).

This document is the product-function inventory requested at the end of the
2026 milestone. It describes the deployed behavior, not merely code that has
passed CI. The gap list is based on production acceptance and regression
testing of every pull request merged on 2026-08-30, every milestone pull
request from #73 through #88, the production remediations through PR #167, and
the concept-gap merge and acceptance flow through PR #180. The status below
separates production-accepted behavior from deployed changes whose acceptance
is still pending or externally blocked.

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
- `/api/health/notification-scheduler/` reported a successful recent scheduler
  run with `ok: true`. The endpoint returned HTTP 503 and `deliveryReady:
  false` because no EMAIL, TELEGRAM or WEB_PUSH delivery provider is configured.
- Analytics retention is owned by an enabled, active production systemd timer.
  Two consecutive idempotent production runs succeeded, the protected endpoint
  failed closed with JSON 401 for an invalid token, and the non-secret state
  file recorded `ok: true`.
- The Admin Console preserves `/admin/` while switching English, German and
  Russian, renders the authenticated `ADMIN` role truthfully and fits all six
  sections at 320, 375 and 390 px without horizontal overflow. The protected
  admin allowlist is also preserved across production deploys.

## Concept-gap remediation status

All 20 implementation PRs were merged before the verified production commit.
The merge flow rebased conflicted branches, required exact-head CI, deployed
each sequentially and recorded issue-specific production acceptance.

| Issue and merged implementation | Production status |
| --- | --- |
| [#168](https://github.com/KirDE/festival-radar/issues/168) / [PR #170](https://github.com/KirDE/festival-radar/pull/170): database roles on real Admin Console routes | Deployed; full-proxy role acceptance remains pending. |
| [#126](https://github.com/KirDE/festival-radar/issues/126) / [PR #143](https://github.com/KirDE/festival-radar/pull/143): trusted origins on authenticated mutations | Accepted in production. |
| [#40](https://github.com/KirDE/festival-radar/issues/40) / [PR #171](https://github.com/KirDE/festival-radar/pull/171): production notification provider readiness | Deployed and fails closed correctly. **External blocker:** no dedicated production delivery-provider credential is configured, so real delivery is not accepted. |
| [#172](https://github.com/KirDE/festival-radar/issues/172) / [PR #173](https://github.com/KirDE/festival-radar/pull/173): email verification before delivery | API enforcement is accepted. Localized UI acceptance failed because the notification route is forced to English and the EN/DE/RU-prefixed routes return 404. |
| [#169](https://github.com/KirDE/festival-radar/issues/169) / [PR #174](https://github.com/KirDE/festival-radar/pull/174): suppress analytics ingestion access logs | Deployed; controlled production log-count acceptance remains pending. |
| [#22](https://github.com/KirDE/festival-radar/issues/22) / [PR #176](https://github.com/KirDE/festival-radar/pull/176): recover persistent source HTTP 403 failures | Accepted in production. |
| [#175](https://github.com/KirDE/festival-radar/issues/175) / [PR #177](https://github.com/KirDE/festival-radar/pull/177): replace defunct MetalDays with Tolminator 2027 | Accepted by catalogue, route, sitemap and official-source checks. |
| [#125](https://github.com/KirDE/festival-radar/issues/125) / [PR #158](https://github.com/KirDE/festival-radar/pull/158), repaired by [PR #179](https://github.com/KirDE/festival-radar/pull/179): production-owned collection schedulers | Accepted with all four production systemd timers enabled and GitHub collection workflows manual-only. |
| [#133](https://github.com/KirDE/festival-radar/issues/133) / [PR #144](https://github.com/KirDE/festival-radar/pull/144): scoped ingestion acceptance | Accepted in production. |
| [#124](https://github.com/KirDE/festival-radar/issues/124) / [PR #151](https://github.com/KirDE/festival-radar/pull/151): mobile map popup and overflow | Accepted at 320, 375 and 390 px. |
| [#128](https://github.com/KirDE/festival-radar/issues/128) / [PR #150](https://github.com/KirDE/festival-radar/pull/150): canonical notification enums and mobile layout | Accepted with authenticated persistence and 320–390 px layout checks. |
| [#130](https://github.com/KirDE/festival-radar/issues/130) / [PR #152](https://github.com/KirDE/festival-radar/pull/152): localized planner and navigation | Accepted across EN, DE and RU routes. |
| [#131](https://github.com/KirDE/festival-radar/issues/131) / [PR #145](https://github.com/KirDE/festival-radar/pull/145): first-fetch offline payload | Accepted in a fresh browser context with networking disabled after install. |
| [#132](https://github.com/KirDE/festival-radar/issues/132) / [PR #146](https://github.com/KirDE/festival-radar/pull/146): edition-specific future evidence | Accepted for Wacken 2026/2027, unsupported 2028 and sitemap behavior. |
| [#135](https://github.com/KirDE/festival-radar/issues/135) / [PR #148](https://github.com/KirDE/festival-radar/pull/148): curated artist provenance | Accepted on the production Electric Callboy profile. |
| [#136](https://github.com/KirDE/festival-radar/issues/136) / [PR #153](https://github.com/KirDE/festival-radar/pull/153): localized artist routes | Accepted across EN, DE and RU navigation, reload and language switching. |
| [#129](https://github.com/KirDE/festival-radar/issues/129) / [PR #149](https://github.com/KirDE/festival-radar/pull/149): playlist editor and real parser-log UI | Accepted through reversible authenticated production CRUD and parser-log read-back. |
| [#134](https://github.com/KirDE/festival-radar/issues/134) / [PR #147](https://github.com/KirDE/festival-radar/pull/147): YouTube Music production refresh | Spotify succeeded and YouTube failed closed before publishing. **External blocker:** the YouTube Data API returned `403 quotaExceeded`; successful write/read-back awaits quota reset or increase. |
| [#97](https://github.com/KirDE/festival-radar/issues/97) / [PR #141](https://github.com/KirDE/festival-radar/pull/141), repaired by [PR #180](https://github.com/KirDE/festival-radar/pull/180): remove system npm dependency | Accepted through standalone packaging, upload, activation and external production verification. |
| [#98](https://github.com/KirDE/festival-radar/issues/98) / [PR #142](https://github.com/KirDE/festival-radar/pull/142): configure both Plesk vhosts | Accepted at the exact deployed commit: HTTP redirects to HTTPS and both paths render the application. |

Issue [#159](https://github.com/KirDE/festival-radar/issues/159) tracks this
inventory refresh. The table records the remaining acceptance gaps without
claiming that merge or deployment alone resolved them.

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
