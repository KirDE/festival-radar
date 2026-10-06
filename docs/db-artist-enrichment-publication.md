# Bounded artist enrichment publication (#210)

This branch starts at main `1f6a46630ec1212b0c54130f3b680b086f1ce286`.
It changes no production settings, timers, credentials, DB_ONLY flag, playlist
worker or deployment. No migration is needed. Database rows remain the owner;
publication emits no repository files.

## Worker and transaction

`scripts/enrich-artists.mjs` claims the existing two-hour OperationalState lease.
Before the daily nextRunAt gate or any network request, it publishes an already
persisted `artist-enrichment.payload.result`. It also publishes immediately after
saving a new complete result. A crash between save and publication is retried on
restart, even when nextRunAt is in the future. A transaction failure leaves that
complete result pending; the next invocation retries. Intermediate cache saves
occur only after the previous result has been published successfully.

Publication accepts the key/owner returned by claimOperationalState, never an
external result. It locks that row, checks owner and expiry against the DB clock,
and reads its persisted payload. Canonical changes, retained admin
audit evidence, and the result-hash receipt are committed in one serializable
transaction. A final DB-clock lease check rolls back all changes if expiry occurs
during publication. Reclaim cannot pass the same row lock; an expired or replaced
owner cannot publish even an unchanged receipt. The existing two-hour lease is
not extended. Serialization errors propagate for retry on the next invocation.

Limits: 1,000 profile/review entries, 10 MB serialized result/cache input,
10,000 canonical artists, five genres and 50 links per profile, and a 30-second
transaction. Exceeding a global bound fails closed, retaining the persisted
result. The receipt records policyVersion=1, resultHash, changed, applied fields,
review reasons and publication time. Repeating the same hash returns changed=0
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

Synthetic checks:

```sh
node --experimental-strip-types tests/artist-enrichment-publication.test.mjs
node --experimental-strip-types tests/artist-enrichment.test.mjs
npm run typecheck
npm run build
```

Disposable PostgreSQL integration uses a separate explicit
`ARTIST_ENRICHMENT_TEST_DATABASE_URL`. It must be a loopback PostgreSQL URL with
`test` or `integration` in its database name and no host query override. It must
point at a freshly migrated dedicated database without an artist-enrichment row.
The test creates only synthetic artists, cleans up mutable rows, and leaves the
append-only audit in the disposable database for destruction; it never reads
production environment files or imports catalog fixtures. Without that explicit
variable it reports SKIP. After applying repository migrations to that disposable
database, run:

```sh
npm run test:artist-enrichment-db
```

It checks changed publication and field provenance, exact repeat, persisted-result
publication in a separate restarted Node process despite a future nextRunAt,
expired/reclaimed fencing, ambiguity review, and invalid-input rollback.
Synthetic tests additionally exercise expiry at the final write and manual field
protection. Outside the restricted Codex sandbox, the controller ran a fresh
loopback-only PostgreSQL 16 Docker container, applied all 20 migrations and
verified the disposable integration; the container was stopped and removed.

Validation in this sandbox: eight new synthetic tests and two existing artist
checks passed; standalone typecheck passed. The default Next.js build compiled
but its TypeScript CLI subprocess produced unparseable empty showConfig output
(one attempt also segfaulted). A complete build passed with the temporary
`experimental.useTypeScriptCli: false` compiler-API workaround; next.config.ts
was restored afterward and no configuration change is committed.

The broad test:data run passed 68 of 74 test files; its later TypeScript suites
were not reached. The six failing files were db-due-legacy-artifact, db-due-pilot,
deploy-bundled-npm, ingestion-publication, playlist-trigger and
source-backfill-operation. Direct reruns exposed empty child-process output and
sandbox `spawnSync bash/chmod EPERM` errors in unchanged code. These failures are
not claimed as passing, and no unrelated fixes were made. Independently, the
unmodified production build passed outside the Codex sandbox. The disposable
PostgreSQL test was rerun after its append-only audit cleanup was corrected.
