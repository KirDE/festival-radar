# Rockharz 2027 activation (conditional, parent-owned)

Base: origin/main `58abc7c9`. Registers `official_markup:rockharz` for the existing
festival. This task executes no production database writes, provider jobs, source
activation or deployment and imports no PR #280 implementation. Live HTML stays outside Git.

## Four independent source contracts

Every branch requires exact source URL, configured edition 2027, a complete
closed document and a unique bounded content container. No alternate fetch URL,
follow-link or fallback strategies. Candidates stay separate, with evidence
from their own URL; no cross-source facts or inferred ticketsUrl.

| Exact source URL | Bounded evidence/output |
| --- | --- |
| https://www.rockharz-festival.com/bands | Unique canonical/OG URL, post-65077, Bands h1, entry-content, one 2027 h3 followed by closed #content. Extract lightbox anchor title/news asset, validate distinct image linkespalte asset, p and inert bandsocials wrappers. Lineup only. |
| https://www.rockharz-festival.com/headliner-alarm | Unique canonical/OG URL, article:published_time `2026-10-07T14:30:22+00:00`, post-84153, HEADLINER-ALARM! h1, exact bounded 2027 billing paragraph. Headliners only: AMON AMARTH. |
| https://ticketmarktplatz.rockharz-festival.com/ | Exact ROCKHARZ Ticketmarktplatz 2027 document title, unique main#top/hero, Ticketmarktplatz h1 and kicker. Parse 2027 dates in any German named month and bounded city independently; unique footer must corroborate. Valid changed dates are supported; reversed/overflow/conflicting dates fail. Dates/city only. |
| https://www.rockharz-festival.com/das-rockharz-2027-ist-ausverkauft | Unique canonical/OG URL, article:published_time `2026-07-09T15:33:09+00:00`, post-82346, exact sold-out h1 and bounded edition-specific statement. Typed ticketStatus unavailable only, carried through normal adapter evidence and extraction merger. |

The live lightbox's two identical `class="ngg-simplelightbox"` attributes are
supported; duplicate title/href, conflicting class or other duplicate attributes
fail. The bounded excerpt records the exact alias mapping and observed captions
(up to the existing evidence length limit); three exact
caption/asset pairs map to reviewed identities: IGELS VS. SHARK → IGEL VS. SHARK,
SETYOURSAILS → SETYØURSAILS, SKALD → SKÁLD. These are not general normalization
rules; changed text/asset is refused, and alias duplicates fail. Before activation,
parent must compare these three with existing artist names/slugs/aliases and stop
if they would create duplicate identities or conflict with catalog state.
All 29 reviewed baseline captions must remain, but valid additional closed tiles with unique official 2027 assets
are accepted (150-tile sentinel). New names are provisional review evidence,
never silent identity approval. Additional names keep the whole candidate in
REVIEW until independent review and a deployed parser revision approve them.
Missing baseline, truncation, duplicate or unexpected tiles yield no lineup and cannot propose mass removals. The first-wave
article is corroboration only; GRAVE DIIGGER/SKĀLD/SKÀLD are never new identities.
No grid ordering or sidebar tiles establish headliners.

After separately approved source cutover, the next normal guarded due tick
publishes baseline lineup additions, exact AMON AMARTH billing and unavailable
ticket status through `publishIngestionResult`, updating existing catalogue/
edition/lineup rows and marking persisted candidates PUBLISHED atomically.
Marketplace baseline is unchanged when current dates/city already match.
Removals, novel artists and changed dates remain REVIEW under the existing
policy; changed city gets an explicit adapter warning even though scalar city
policy alone permits it. Valid corroborated August dates and city changes are
extracted as review evidence rather than discarded. Date support is a range of
2–8 inclusive days within one named month; wrong year, overflow, reversed range
or conflicting footer fails closed. No admin edit or special mutation endpoint
is part of this workflow; the read-only review queue cannot publish REVIEW rows.

Normal ingestion follows existing global publication behavior: a lineup/headliner
change queues a `CatalogPlaylistRefresh` row; ticket-status-only changes do not.
The parser does not call a provider or bypass the normal publication policy.
Parent must separately review the queued refresh worker/provider consequences before
activation; a provider-side action may follow ingestion under existing scheduling.

Synthetic fixtures mirror actual structures, not live snapshots. Local read-only
probes of the supplied `/tmp/rhz-*-live.html` captures dated October 8 2026 yielded
29 lineup names, AMON AMARTH billing, July 7–10/Ballenstedt, and unavailable,
respectively. Recheck current evidence at activation, especially the October 9 wave.

## Activation gates

A parent read-only production snapshot on 8 October found **one enabled Rockharz
2027 homepage FestivalSource**, using `json_ld_event+html_fallback`, with zero
lineup entries, UNKNOWN ticket status and next run on 9 October. It did not
verify any of the four exact URL rows above. Re-read and reconcile that inventory
before any change; `rockharz` is a reported binding, not proof of a four-source
configuration.

1. Parent rechecks the **read-only current** FestivalSource/catalogue inventory.
   Account for the existing enabled homepage row and any later exact-URL rows.
   Record IDs and verify slug/festival ID/edition ID/year 2027, dates/artists,
   exact URLs, strategies/parserKey, enabled state, cadence, fetch/follow-link,
   validators, leases and configuration versions/updatedAt. Check candidate/
   attempt freshness and pending provider jobs. Missing exact-URL rows require
   separately reviewed, parent-owned source **configuration creation** bound to
   the existing festival/edition; never insert another festival. Keep sensitive
   snapshot material outside Git.
2. Parent independently verifies current raw markup, artist identities
   (especially the three exact aliases and preexisting slugs/aliases), and
   baseline/new-wave completeness. Synthetic tests and captured historical HTML
   alone do not authorize activation or publication.
3. Controller reviews/publishes this branch separately. Parent deploys and
   independently verifies the **exact full deployed SHA containing this registry
   before source cutover**; record it. The base or dynamically derived checkout
   SHA does not substitute for deployed revision verification.
4. Parent separately reviews/manages a narrow, audited source-configuration
   cutover: first fence the existing homepage row against competing leases and
   change it to disabled/manual_review as approved, preserving its prior config.
   Create or convert **only** reviewed rows for the four exact URLs above, bound
   to the existing festival and 2027 edition, with strategies
   `["official_markup"]`, parserKey `official_markup:rockharz`, no alternate
   fetch/follow-link/fallback. Require exact preflight IDs/versions/URL/edition,
   expected row counts, no active leases, and deployed registry SHA; audit before
   and after, reset stale HTTP validators and set an intended cadence/next run.
   Abort on drift. A version-guarded rollback disables new sources/restores the
   prior homepage configuration; it never deletes committed catalogue facts or
   immutable publication evidence. No source configuration or content mutation
   is executed by this PR.
5. Verify fresh baseline attempts publish the intended existing 2027 additions/
   ticket status (or are UNCHANGED when already applied), with source-specific
   evidence and candidate/publication lineage. Confirm normal refresh queue rows
   for lineup/headliner publications, none for ticket-only changes, and
   idempotent replay without duplicate jobs. Novel
   names/date/venue drift stay REVIEW; invalid markup has zero fields/diffs.
   Independent review plus parser/policy revision and deployment is required
   before a REVIEW candidate can re-enter the normal importer. Do not assume
   review-queue export or a manual admin edit is that normal path. Parent owns
   preflight, deploy, source cutover and rollback; none is executed here.

Bounded local checks (synthetic, no database):

```sh
node --import tsx tests/ingestion-rockharz-markup.test.mjs
npm run typecheck
```

Disposable PostgreSQL host check (existing guarded E2E fixture, including normal
playlist refresh queue behavior and Rockharz commit/replay/collision cases):

```sh
node --import tsx --test tests/catalog-publication.e2e.test.ts
```

Requires an explicitly supplied local disposable test/integration DATABASE_URL.
No PostgreSQL server/binaries are available in this sandbox, so this DB check is
prepared for the controller; local focused tests use transactional table doubles.
