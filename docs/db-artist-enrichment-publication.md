# Bounded artist enrichment publication (#210)

This branch starts at main `1f6a46630ec1212b0c54130f3b680b086f1ce286`.
It changes no production settings, timers, credentials, DB_ONLY flag, playlist
worker or deployment. No migration is needed. Database rows remain the owner;
publication emits no repository files.

## Worker and transaction

`scripts/enrich-artists.mjs` claims the existing two-hour OperationalState lease.
Before the daily gate or provider requests, it retries publication of durable
results, including flat legacy imports. Flat `{schemaVersion, source,
generatedAt, profiles, manualReview}` imports are migrated into `result` and
an immutable `legacyImport: {hash, evidence}` snapshot. The snapshot preserves
profiles and complete reviews, including candidate IDs. It is retained in every
worker checkpoint and publication audit. Its SHA-256 hash uses sorted JSON keys
so PostgreSQL JSONB key ordering does not break integrity checks.

A flat import with no provider search produces explicit `missing_provider_search`
reviews and zero canonical writes. Profile provenance URLs alone cannot authorize
publication. Missing imported profiles in later results receive
`imported_profile_not_in_result` reviews. Invalid/unsafe/oversized imports fail
closed without replacing their original payload. Evidence is bounded by bytes,
structure and string length; credential-bearing URLs and secret fields are
rejected without echoing their contents.

The worker checkpoints before provider work, after each fetched response, after
each artist decision, and after failures. It retains existing profiles until
fresh evidence establishes a replacement, and keeps imported reviews in legacy
evidence. `work` tracks the catalog names/slugs and completed artists. Restart
reuses checkpointed responses and skips completed artists. Network failures
remain incomplete with a sanitized `source_unavailable` review and no daily gate.
A complete run can include terminal manual-review decisions; it gets the daily
gate only after every catalog artist has been handled. Missing cached profile
proof also bypasses the gate. New scheduled runs fetch new provider evidence;
legacy cache/progress without `work` is preserved for its first resumed run.
A crash after the final save retries publication before the daily gate. Requests
have a timeout and bounded retries; raw network/driver errors are never logged.

Publication accepts the key/owner returned by claimOperationalState, never an
external result. It locks that row, checks owner and expiry against the DB clock,
and reads its persisted payload. Canonical changes, retained admin
audit evidence, and the result-hash receipt are committed in one serializable
transaction. A final DB-clock lease check rolls back all changes if expiry occurs
during publication. Reclaim cannot pass the same row lock; an expired or replaced
owner cannot publish even an unchanged receipt. The existing two-hour lease is
not extended. Serialization errors propagate for retry on the next invocation.

Limits: 1,000 profile/review entries, 10 MB serialized result/cache/legacy evidence,
10,000 canonical artists, five genres and 50 links per profile, and a 30-second
transaction. Exceeding a global bound fails closed, retaining the persisted
result. The receipt records policyVersion=2, resultHash, changed, applied fields,
review reasons and publication time. The hash covers result, cache and legacy import. Changing or removing provider
evidence invalidates a prior receipt and triggers validation again. Repeating the
same hash returns changed=0
without writes. A different result also leaves existing canonical values intact.

## Identity and field policy

Resolution requires the exact canonical slug plus one exact canonical name/alias
match, and one exact provider name/alias match in persisted MusicBrainz search.
Matching uses NFC, surrounding whitespace removal and case folding; punctuation
and accents stay significant. Truncated search results require review. The
selected MusicBrainz UUID must equal the proposed UUID and must not belong to
another canonical artist. Missing artists, duplicate canonical names/aliases,
AMBIGUOUS identity state, conflicting identities, overlapping manualReview and
profiles, malformed or missing provider evidence all require review. No artists
are created or renamed. Alias-only provider matching is allowed only when exactly
one provider candidate matches the existing canonical name.

Only a missing musicbrainz identity, null origin, empty genres and additional
nonduplicate URLs can be written. Origin/tags/relations must match the persisted
provider candidate, with matching field/source/URL/date provenance no later than result generation. Existing
values, any field provenance, artist AdminResourceState values and pending,
approved or conflicted artist AdminChange fields protect their fields. An absent
identity with identity/identities/identityState protection or LINKED state blocks
the entire candidate; profile/link publication must not bypass identity review.

New links carry source=musicbrainz and verified=false even though the historical
result calls provider relations official/verified. Each inserted link receives
links provenance to the MusicBrainz evidence URL. Existing link metadata stays
untouched. The inferred setlistFm UUID in the old result is validated for
consistency but is **not** published: this result has no independent setlist.fm
evidence. identityState, freshness, Spotify, biography, images, aliases, music and
setlists stay untouched. This is fill-only enrichment; changes to nonempty fields
remain review work, including values previously inserted by this publisher.

## Explicit schema/behavior uncertainties

ArtistProvenance has no manual/reviewed flag or ownership/version token.
ArtistIdentity has no per-identity provenance relation. We therefore treat every
existing value and every provenance record as protected, and retain identity
proof under field=identity rather than claiming finer ownership. LINKED does not
say which provider was reviewed, so it cannot authorize an absent identity.

The generic admin approval handler publishes canonical festival changes, but
ARTIST approval only updates AdminResourceState. Consequently this publisher
**does not** create misleading auto-approvable AdminChange rows. Review candidates
and their source searches remain in `AdminAuditEntry` action
`ARTIST_ENRICHMENT_PUBLICATION`, alongside the complete result snapshot and the
OperationalState receipt. They survive a later result replacing the payload.
Resolving them into reviewed canonical artist changes needs a separate reviewed
artist-publication workflow; no review UI or automatic acceptance is introduced.

A unique name in a complete MusicBrainz response is evidence, not proof against
all real-world homonyms. Search count must be present and consistent; truncation or legacy persisted
responses without a count require review. A
missing cached response cannot be published. Cached responses are not re-fetched
by this bounded publication step, so it does not assert provider freshness.

## Verification

Focused unit checks cover publication protections and lease rollback, flat import
retention and review audit, missing/truncated/ambiguous search proof, receipt
invalidation, safe evidence bounds, failed fetch, partial progress, re-entry after
a search checkpoint, restart after final save, and idempotent restart:

```sh
node --experimental-strip-types tests/artist-enrichment-publication.test.mjs
node --experimental-strip-types tests/artist-enrichment.test.mjs
npm run typecheck
```

Disposable PostgreSQL integration requires an explicit
`ARTIST_ENRICHMENT_TEST_DATABASE_URL`. It must be a loopback PostgreSQL URL with
`test` or `integration` in its database name and no host query override, pointing
at a freshly migrated dedicated database without an artist-enrichment row.
The E2E check exercises flat migration/retention across a JSONB round trip and
restart, canonical publication, transaction rollback, lease fencing, ambiguity
review, and a separate Node process retry after durable result save. It leaves
append-only audit evidence in that disposable database. No database is started
by the test; without the explicit variable it skips.

```sh
node --experimental-strip-types tests/artist-enrichment-publication.e2e.test.mjs
```

Publication validates persisted bounded MusicBrainz search evidence; it does not
itself make network calls or assert freshness. Manual review remains necessary
for ambiguous, unbounded, truncated or unsupported evidence. No independent
setlist.fm identity is inferred or published. No production/server actions are
required for these changes.
