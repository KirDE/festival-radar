# Festival Radar product status

Last verified: 2026-08-31 (production at `https://festivals.kir-it.de`, merge
`f7b0bd142b47ae022b29c9e04d8f063ea71b2374`).

This document is the product-function inventory requested at the end of the
2026 milestone. It describes the deployed behavior, not merely code that has
passed CI. The gap list is based on production acceptance and regression
testing of every pull request merged on 2026-08-30 and every milestone pull
request from #73 through #88.

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

## Remaining gaps against the concept

The following are confirmed production or acceptance gaps. They are not hidden
behind a generic “deployed” status.

| Area | Gap | Tracking |
| --- | --- | --- |
| Ingestion review | Scheduled ingestion can push its review branch but cannot create the required pull request. | [#113](https://github.com/KirDE/festival-radar/issues/113) |
| Runtime ownership | Data collection still depends on GitHub workflows; production-owned execution is required. | [#125](https://github.com/KirDE/festival-radar/issues/125) |
| Mobile discovery | The map popup is clipped/unusable and the planner overflows at 390 px. | [#124](https://github.com/KirDE/festival-radar/issues/124) |
| Sessions | Apache rejects the real same-origin logout request, leaving the session valid. | [#126](https://github.com/KirDE/festival-radar/issues/126) |
| Notifications | GitHub cron has multi-hour gaps and is not a durable production scheduler. | [#127](https://github.com/KirDE/festival-radar/issues/127) |
| Notification UI | Six non-default event types submit non-canonical values; authenticated mobile layout overflows. | [#128](https://github.com/KirDE/festival-radar/issues/128) |
| Administration | Artist, asset and playlist editors and a real parser-log workflow remain incomplete. | [#129](https://github.com/KirDE/festival-radar/issues/129) |
| Localization | German/Russian navigation and planner views retain English strings. | [#130](https://github.com/KirDE/festival-radar/issues/130) |
| Offline data | A fresh precached offline payload is treated as stale and deleted on first offline use. | [#131](https://github.com/KirDE/festival-radar/issues/131) |
| Edition provenance | The 2028 Wacken record lacks edition-specific official evidence. | [#132](https://github.com/KirDE/festival-radar/issues/132) |
| Manual ingestion | A slug-scoped manual run does not preserve the requested scope through its production contract. | [#133](https://github.com/KirDE/festival-radar/issues/133) |
| YouTube Music | Production refresh is not configured with a usable provider credential. | [#134](https://github.com/KirDE/festival-radar/issues/134) |
| Artist provenance | A curated identity override can retain provenance from a different generated identity. | [#135](https://github.com/KirDE/festival-radar/issues/135) |
| Artist localization | Localized artist links fall back to the unlocalized route, making translated enrichment unreachable. | [#136](https://github.com/KirDE/festival-radar/issues/136) |
| Analytics retention | Retention runs on a hosted runner with a production-local database URL and cannot prune old aggregates. | [#137](https://github.com/KirDE/festival-radar/issues/137) |
| Release portability | The installer still relies on a hidden system npm dependency and only configures one Plesk proxy vhost variant. | [#97](https://github.com/KirDE/festival-radar/issues/97), [#98](https://github.com/KirDE/festival-radar/issues/98) |

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

