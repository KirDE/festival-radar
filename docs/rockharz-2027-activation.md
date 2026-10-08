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
| https://www.rockharz-festival.com/headliner-alarm | Unique canonical/OG URL, article:published_time `2026-10-07T14:30:22+00:00`, post-84153, HEADLINER-ALARM! h1, exact bounded 2027 billing paragraph. Headliners: AMON AMARTH; status: partial, with evidence from the same confirmed billing. |
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

Rockharz **2027 only** lineup/headliner catalogue publications from exact reviewed
`/bands` and `/headliner-alarm` sources defer provider playlist refresh. The
publication still records `lineupChanged: true`, but its immutable evidence records
`playlistRefresh.status: deferred`, policy, reason and candidate/evidence IDs. No
`CatalogPlaylistRefresh` row is created; replay returns the persisted absence
without queueing. The exact `/headliner-alarm` contract also permits a simultaneous
`status: partial` change, or a status-only repair when AMON AMARTH is already
published (including the existing 29 lineup + 1 headliner state). Every changed
field requires both candidate and persisted evidence from that exact URL;
status additionally requires candidate/after value `partial`. Status-only audit
records deferral with `lineupChanged: false` and never creates a refresh row.
Source/edition/field/persisted-evidence drift fails closed and
rolls back rather than falling through to provider enqueue. Ticket-only changes
never queue. Other festivals/editions and admin edits retain default behavior.
A separate authorization is needed to initiate later provider activity.

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
   Record the existing source ID for a CAS-retarget to `/bands`, and verify
   slug/festival ID/edition ID/year 2027, dates/artists,
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
   cutover. Fence leases and CAS-retarget the **existing homepage source ID** to
   exact `/bands` for edition 2027; preserve its prior configuration for rollback.
   Create **three**, not four, additional bound source rows for exact
   `/headliner-alarm`, ticket-marketplace and sold-out article URLs. Each of the
   four final rows uses strategies `["official_markup"]`, parserKey
   `official_markup:rockharz`, no alternate fetch/follow-link/fallback. Require
   exact preflight ID/versions/URL/edition, expected row counts, no active
   leases, and deployed registry SHA; audit before and after, reset stale HTTP
   validators and set intended cadence/next run. Abort on drift or concurrent
   changes. A version-guarded rollback disables the three newly created rows
   and restores the original source ID/configuration. It never deletes committed
   catalogue facts or immutable publication evidence. This PR executes no
   production source configuration or content mutation.
5. Verify fresh baseline attempts publish the intended existing 2027 additions/
   ticket status (or are UNCHANGED when already applied), with source-specific
   evidence and candidate/publication lineage. Confirm audited deferral and
   **zero new playlist-refresh rows** for lineup/headliner publications; replay
   remains false without enqueue. Novel
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

Disposable PostgreSQL host check (existing guarded E2E fixture, including
non-Rockharz default queue and Rockharz deferral/replay/collision cases):

```sh
node --import tsx --test tests/catalog-publication.e2e.test.ts
```

Requires an explicitly supplied local disposable test/integration DATABASE_URL.
No PostgreSQL server/binaries are available in this sandbox, so this DB check is
prepared for the controller; local focused tests use transactional table doubles.
