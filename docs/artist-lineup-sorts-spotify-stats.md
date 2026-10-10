Festival detail sorts only the non-headliner section: official source order by
default, locale-aware alphabetical order (base collation), first scheduled
performance by local calendar date/start, and Spotify artist popularity descending.
Cancelled performances and missing/invalid dates or start times do not establish
chronological order. Unknown popularity sorts last; a returned zero is real data.
All ties preserve the official lineup position. Headliners keep their own section.

The artist page labels the Spotify popularity index (0–100) and followers in
English, German and Russian. Neither statistic is monthly listeners. A successful
observation carries the Spotify artist ID, Web API source URL and UTC checked time;
followers are stored as nullable BIGINT and projected as a JSON-safe number.
The single nullable migration adds no default values or backfill. It has not been
applied to any database by this task.

Stats refresh runs hourly through the `spotify-stats` collection timer, with a
24-hour gate on each verified artist observation and the shared artist-enrichment
lease. `scripts/refresh-spotify-stats.mjs` is independent of MusicBrainz completed
checkpoints, so introduction of stats and later identity resolutions are not
silently skipped. It retains a durable numeric run summary in OperationalState.
The original artist-enrichment integration remains available for ad-hoc refreshes.
Only existing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET configuration is used.

Canonical identities may be filled from the resolver's single cross-provider
match only when both provider names exactly agree, MusicBrainz explicitly links
the Spotify ID, and a fresh Spotify Get Artist response confirms that ID/name.
Publication rechecks the persisted resolver evidence, canonical ownership,
existing identities/verified links, administrative overrides and pending changes
in a serializable lease-fenced transaction. Conflicts and ambiguous matches are
not overwritten. Each new verified Spotify link has provenance and an audit entry.
No name-only match or playlist mutation is accepted.

Spotify's Get Artist documentation marks both popularity and followers deprecated:
https://developer.spotify.com/documentation/web-api/reference/get-an-artist
A successful artist response with omitted/null/invalid fields records null for
those fields. Wrong ID/type, transport errors, forbidden/rate-limited responses,
missing configuration and temporary API failures retain older metrics and their
original timestamp. An artist-specific 404 does not stop other artists. For authentication, rate-limit
or transport failures the fetcher stops requests for the rest of that invocation, then retries on the next due artist-enrichment run.
An observation older than the stored snapshot cannot overwrite it. No name-based
homonym or inferred zero is accepted. No live provider request was made for tests.

Verification: npm run typecheck; node --experimental-strip-types --test
--test-isolation=none --test-skip-pattern=symlinked with artist-lineup-sorts.test.ts,
artist-spotify-stats.test.mjs, artist-enrichment-publication.test.mjs,
artist-enrichment.test.mjs, artist-identities.test.mjs, artist-localization.test.mjs,
lineup-announced-ui.test.mjs and timetables.test.mjs. The existing symlinked
entrypoint test uses spawnSync, which this sandbox rejects with EPERM; its
entrypoint/exit/error behavior was separately verified through a shell symlink
invocation with DATABASE_URL empty. No DB integration or migration execution was
performed.

Changed files:
- UI: components/FestivalDetail.tsx, components/ArtistDetail.tsx,
  components/LanguageProvider.tsx, app/globals.css.
- Page wiring: app/festivals/[slug]/page.tsx,
  app/[lang]/festivals/[slug]/page.tsx.
- Domain and sorting: lib/domain/artist.ts, lib/festival-lineup.ts.
- Identity, refresh and repository: lib/artist-spotify-identity.ts,
  lib/catalog/artist-spotify-stats.ts, lib/catalog/repository.ts,
  scripts/enrich-artists.mjs.
- Schema: prisma/schema.prisma,
  prisma/migrations/20261008120000_artist_spotify_stats/migration.sql.
- Tests: tests/artist-lineup-sorts.test.ts, tests/artist-spotify-stats.test.mjs.
- Documentation: docs/artist-lineup-sorts-spotify-stats.md.
