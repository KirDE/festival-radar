# Nova Rock full-card observation prerequisite: non-authorizing fallback

Base: PR #287 exact `2531f0a038f16788d7b893a663889f6eb5eabe59`.
The fetcher, adapter, acquisition provenance, content seal, review draft,
security/authentication discussion in the review contract, and reviewed markup
fixture were inspected before implementation.

The chosen deliverable is a **pure non-authorizing document verifier**, with an
optional fresh persisted-read wrapper. It is NOT independently re-fetched network
evidence. There is no observation table, attestation INSERT, migration, approval,
source activation, publisher, HTTP route, CLI, scheduler or transport integration.
The existing adapter, draft validator and ingestion policy are unchanged. Passing
this verifier does not remove the draft's independent-evidence blocker.

## Why acquisition remains blocked

`fetchSource` follows redirects, retries, allows source request headers, alternate
fetch URLs and follow-link extraction. It is unsuitable for the requested strict
observer. Existing acquisition provenance binds a claimed configuration/generation
and lease; it does not authenticate a separate capture, complete document bytes,
trusted verification actor or deployed parser revision. A digest of bytes supplied
by a caller, including a fixture, cannot establish independent network provenance.
A fresh fetch in the same unauthenticated process would not establish that missing
trust boundary either. The repository has no trusted independent capture service
or immutable authenticated capture reference to compose with these seals.

Consequently this code accepts no HTTP status/URL/timestamp/provenance assertions
from callers and persists no purported observation. `sourceId`, `attemptId`,
`candidateId` and `contentDigest` correlate the supplied document to content,
not to a network acquisition. There is deliberately no `observedAt`: a verifier's
clock must not be misrepresented as a capture time. All results have `authority:
"NONE"`, `UNTRUSTED_DOCUMENT_VERIFIED_NON_AUTHORIZING` status, and explicit
`NO_TRUSTED_INDEPENDENT_NETWORK_PROVENANCE` / `NO_DEPLOYED_EXTRACTOR_ATTESTATION`
blockers. Results are transient and must never become publication authority.

## Verification contract and assumptions

`verifyNovaRockCardDocument(bytes, sealedContent)` verifies strict UTF-8 document
bytes against a complete supported content-seal snapshot. It copies bytes before
parsing/hashing. Limits are 512 KiB, 30,000 markup tokens and nesting depth 64.
SHA-256 covers every supplied byte, including comments, whitespace and unrelated
head markup; it is not an excerpt/card hash. The function returns exactly 44
ordered tuples `{caption, officialUrl, day, billing, position}`, 4 HEADLINER then
40 LINEUP, role-relative zero-based positions, and day counts 8/14/10/12 for June
9–12. Decoding, NFC and whitespace normalization apply to captions; the resulting
ordered captions must exactly match the sealed normalized headliner/support bill.
URLs must be exact HTTPS `www.novarock.at/artist/<slug>/` with no credentials,
ports, query or fragment. Slugs remain evidence strings; no internal artist IDs
are looked up, inferred or returned. A changed valid official artist URL can
still verify because the seal has no per-card URL facts to compare. Day assignment must match the observed ordered
44-position vector, not merely four counts; this pins one read-only snapshot
without authenticating its source. None of these checks is identity approval.

The independent grammar imports neither the ingestion adapter nor provider code.
It requires the 2027 title, canonical and OG identity, one visible main/header/
section/grid, exactly 44 closed cards, unique captions and URLs and the pinned
caption/image/meta shape. It rejects malformed nesting, duplicate attributes,
hidden or executable ancestry, unsafe inline styles, unknown entities,
duplicate identity metadata, card/grid copies outside the single visible 2027
block, and incomplete documents. The inspected original page wrappers and opaque
rawtext are accepted only when every entire opaque element matches its pinned
SHA-256 fingerprint. Unknown or duplicated blocks fail closed. Fingerprints are
syntax allowances for this snapshot, NOT network provenance, browser behavior or
review of JavaScript/CSS semantics; legitimate dynamic changes may reject.
Offline tests include compact and clearly labeled synthetic full-page fixtures.
The controller separately supplied the *unmodified* 216,722-byte original capture:
44 cards with SHA-256 bc00681acd4b8251fa1f35fd4613209ccc9481c48fef207d1484c32804fc4853
and authority NONE. No raw capture is committed. Never strip or rewrite a live
response and claim its resulting hash is of the original document.

`verifyNovaRockCardObservation(db, exactBinding, bytes)` accepts only exact
seal/candidate/content-digest keys. Its bounded 10-second Serializable transaction
locks the acquired source, then uses the existing fresh seal verifier's run/
attempt/candidate locks and full re-digest, then locks festival and edition.
It requires original PENDING/REVIEW lineage, CURRENT Nova 2027 binding, enabled
matching configuration/digest/generation and lease version, quiescent lease,
no request headers and no competing enabled source. The seal verifier rejects
newer or tied attempts, including failures/placeholders. Source swap-away/back
cannot reset generation. Every replay does these reads again; historical attempts
are never backfilled. Serialization errors propagate; only a new transaction may
retry. The wrapper writes nothing and cannot preserve an authoritative observation
between calls. Row locks and Serializable checks protect the read transaction,
not future actions after it returns. No artist/catalogue/reviewer authorization
or production-ID policy is implied by this wrapper.

## Future strict independent transport gate (unimplemented)

The controller must establish a trusted capture/verifier boundary before any
persisted attestation. Its transport must internally pin ONLY
`https://www.novarock.at/lineup/`, single GET, TLS certificate verification,
redirect refusal (including same-host), no retry/fallback/follow-link/alternate
URL, credentials/cookies/authorization or caller headers. Require exact final
URL, HTTP 200, supported HTML content type/encoding, bounded streamed bytes and
a total deadline covering headers AND body, cancellation and no provider imports.
Use a distinct acquisition rather than the ingestion attempt's response. Bind
complete raw-byte SHA-256, immutable authenticated document reference and capture
time to the exact current candidate/content seal/source attempt, with fresh source
and latest-attempt rechecks. An append-only record would additionally require
restrictive FKs, update/delete/truncate triggers and validated Serializable races.
Those guarantees are absent here; no synthetic fixture or caller flag substitutes
for them. Capturing once must never authorize publication.

## Validation and remaining acquisition gate

Local: normal `npm run typecheck` with
`XDG_CACHE_HOME=/tmp/novarock-card-prisma-cache` (local Prisma generation), 27
verifier tests, 9 seal tests, 19 draft tests, 7 Nova parser tests, 4 provenance
tests, 3 policy tests and 2 publication tests passed. Tests use only checked-in
fixture bytes and perform no HTTP requests. The compact and synthetic full-page
fixtures are NOT the original official capture and have different hashes.

The new `tests/novarock-card-observation.e2e.test.ts` uses real Prisma/PostgreSQL.
The existing local-disposable URL guard runs before connecting. Exact synthetic
Nova namespaces must be absent; unrelated migration seed rows are retained.
It checks transient success/replay/concurrent reads, wrong bindings, late caption
mutation, source config/header/lease drift, swap-away/back generation, newer failed
attempts, actual Serializable isolation and writer-first source/edition races
observed with `pg_blocking_pids`. Only SQLSTATE 40001 / Prisma P2034 serialization
errors qualify. Global catalogue snapshots and publication/playlist-refresh/
playlist counts must stay unchanged; original PENDING/REVIEW remains. Race writes
are synthetic test setup only. Fixture seals are retained; discard the database.

**Real PostgreSQL E2E passed independently:** the controller used a newly created
postgres:16-alpine container on localhost with isolated database `novacard_test`.
All 24 migrations applied and the new E2E passed 9/9 twice, including after
the full-page grammar change, with Serializable source/edition races, drift,
replay and unchanged publication/refresh counts. Both owned containers removed.
The disposable URL guard also refused an unset DATABASE_URL. No production
credentials or database were used. To repeat on a fresh isolated database:

```sh
npx prisma migrate deploy
node --import tsx tests/novarock-card-observation.e2e.test.ts
```

The DB gate and successful read of existing raw bytes cannot establish trusted
independent network acquisition, HTTP provenance, deployed-parser attestation
or authenticated artist mappings. This is a draft stacked PR: no merge, deploy
or production action is justified by this helper.
