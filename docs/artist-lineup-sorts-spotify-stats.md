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

Stats refresh runs within the existing artist-enrichment worker, under its existing
OperationalState lease, daily gate and restart checkpoints. It executes for each
due artist before MusicBrainz work, including artists whose MusicBrainz lookup
fails. The CLI injects the Spotify refresh into the testable worker. No new timer,
playlist processing, ingestion policy or identity resolver behavior is introduced.
Only existing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET environment configuration
is used by the lazy client-credentials reader; no credentials were accessed or
changed during implementation. Tests mock provider responses.

Identity protection requires a canonical LINKED record, exactly one Spotify
identity, and a verified Spotify artist link agreeing with that ID without any
conflicting verified Spotify artist links. Publication rechecks these conditions
and unique canonical ownership in a serializable lease-fenced transaction after
the request. It never creates an identity, searches Spotify by name, or publishes
resolver candidates. The existing identity resolver saves cross-provider evidence
to OperationalState but does not publish reviewed canonical Spotify identities.
Artists lacking an existing verified binding therefore remain unknown; accepting
new candidates still requires the existing identity review process. LINKED alone
cannot establish which provider was verified. The public repository suppresses
old observations if their ID no longer agrees with the verified binding.

Spotify's Get Artist documentation marks both popularity and followers deprecated:
https://developer.spotify.com/documentation/web-api/reference/get-an-artist
A successful artist response with omitted/null/invalid fields records null for
those fields. Wrong ID/type, transport errors, forbidden/rate-limited responses,
missing configuration and temporary API failures retain older metrics and their
original timestamp. The fetcher stops provider requests for the rest of that worker
invocation after a failure, then retries on the next due artist-enrichment run.
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
