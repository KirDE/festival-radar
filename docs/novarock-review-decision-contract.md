# Nova Rock 2027 review decision prerequisite: draft fallback

Base: `13f74643` (PR #286). The sibling
`../novarock-guarded-publication/docs/novarock-2027-publication-design.md` was
inspected read-only, together with the content seal, provenance, admin passkey
routes, `currentAdmin`, `requireAdminActor`, `currentUser`, origin protection and
User/festival/source/edition/artist/lineup schemas.

**Outcome: non-authorizing draft validation only.** Independent card evidence
cannot be established from the persisted acquisition records. Consequently this
branch introduces no `NovaRockReviewDecision` table, decision INSERT, endpoint,
approval, seed approval, activation, publisher or provider action. No actual
candidate is reviewed. An integrity seal or successful draft result cannot be
consumed as authority. The original candidate remains PENDING and its attempt
remains REVIEW; no APPROVED transition is needed or performed.

## Concrete evidence and authentication boundary

`novarock.ts` checks cards internally but returns the headline/support arrays and
one bounded excerpt. `IngestionEvidence` persists those arrays, not all 44 card
captions, URLs, days and document order. The seal binds the data that exists; it
cannot verify omitted raw evidence. This repository has no independently acquired
immutable full-card evidence record or trusted capture/verifier binding that can
be joined to a sealed attempt. Repeating this adapter, trusting a submitted URL,
accepting `independentlyVerified: true`, storing a caller-supplied hash or supplying
synthetic fixtures would not establish independent review. Draft card URLs and
days are explicitly **unverified claims** even after all consistency checks pass.

Existing authentication is usable for a future reviewed route, rather than an
intrinsic inability to authenticate admins. Passkey verification establishes a
session; `currentUser` resolves its token hash to an unexpired Session and fresh
User row. User has no active/disabled or expiry column; current ADMIN role and a
live session must define active reviewer authority. Default admin helpers allow
EDITOR too. `currentAdmin(["ADMIN"])` also checks the ADMIN_EMAILS allowlist, while
`requireAdminActor(["ADMIN"])` does not. Any authorizing route must deliberately
choose/document that policy, reject untrusted/missing Origin before mutations,
derive the reviewer from the authenticated session, and recheck the User/session
and decision expiry under locks immediately before INSERT. A body-supplied user
ID, email, actor label or session ID is not authentication. This branch adds no
route: no calling person is authenticated by the draft validator.

The blocking prerequisite is an independent evidence acquisition/verification
contract with an immutable full-document reference, exact source/attempt binding,
all 44 caption/URL/day/billing/order records, verification actor/time and trusted
verifier authority. Deployed extractor attestation also remains unresolved:
`sourceCommit` is sealed text, not independent deployed revision proof. The
controller owns independent evidence review and any subsequent PR.

## Draft implementation

`lib/ingestion/novarock-review-draft.ts` offers:

- `parseNovaRockReviewDraft`: strict v1 JSON, exact source
  `cmuaee22i00xy6ncnc5uf6xxk` and edition `cmuaee1xc00tf6ncn76ea3pu2`,
  catalogue-only Spotify-deferred scope, June 9–12 target and unchanged PARTIAL,
  exactly 44 distinct ordered proposed cards (4 headliners/40 support), official
  artist URL syntax, four day claims, billing positions, explicit canonical or
  declared alias match, and distinct artist/card/URL/baseline IDs. Unknown fields,
  caller approval/evidence flags, sparse arrays and unsupported JSON fail closed.
- `novaRockDraftBaseline`: a CAS expectation covering complete festival/edition
  rows, all baseline entry IDs, artist IDs, statuses, billing and positions, and
  complete baseline artist rows with identity/link/provenance children. It includes
  timestamps and ordered aliases, not just a scalar row timestamp. Row lists are
  sorted by ID; child relation lists must be read ordered by ID. It grants no proof.
- `validateNovaRockReviewDraft`: a bounded Serializable persisted-read transaction
  (10 seconds) taking locks in source, run/attempt/candidate, festival, edition,
  lineup-ID, artist-ID and proposed User order. It composes the existing seal
  verifier in the **same** transaction, recomputes the seal, rejects newer/tied
  attempts including failed/placeholders, and matches the exact candidate/digest.
  It requires original PENDING/REVIEW lineage, the exact current 2027 edition and
  festival binding, enabled direct official source configuration matching sealed
  acquisition provenance, identical configuration generation and lease version,
  and a quiescent lease (both owner and expiry null). Competing enabled sources
  for the edition or Nova 2027 are rejected. A source swap away/back with a newer
  generation fails. No source configuration is changed.
- The proposed reviewer ID must exist with fresh DB role ADMIN (EDITOR rejected).
  The draft expiry must be future and no more than 24 hours away, checked using
  database wall-clock time after locks and again before returning. This is proposed-user eligibility only,
  **not authentication**, session freshness, a reviewer signature or authority.
- Complete baseline snapshots must match, including the original three announced
  Die Ärzte/Motionless In White/TBS entries. Each proposed artist must already
  exist, retain its full revision/canonical/slug/aliases and have exactly one
  canonical/alias/slug match across the catalogue. AMBIGUOUS identities, unknown
  IDs, duplicate IDs, alias collisions and replacement baseline identities fail.
  No new-identity creation contract is implied. The scan takes at most 10,001
  artist rows and rejects catalogues above 10,000 rather than validating a subset;
  Serializable reads fence concurrent catalogue additions and child-row changes.

A successful result is always:

```json
{
  "authority": "NONE",
  "status": "DRAFT_VALIDATED_NON_AUTHORIZING",
  "blockers": [
    "NO_INDEPENDENT_CARD_EVIDENCE",
    "CALLER_NOT_AUTHENTICATED_BY_DRAFT_VALIDATOR"
  ]
}
```

It also returns the exact seal/candidate/content and draft digests for correlation.
Neither digest is a review decision key or authorization. Replay performs a fresh
read and returns no persisted decision. Concurrent transactions may return a
serialization error; only a fresh retry may revalidate. Validation writes nothing,
so later mutations invalidate a subsequent read without consuming a decision.

This draft is deliberately not the full authorizing policy: it does not approve
warnings/diffs, independently recompute permissible corrections, attest the parser,
verify raw-card claims or authenticate a session. Those checks must be implemented
before a future append-only review decision INSERT. Global ingestion policy,
publisher, parser, schema, source activation and playlist behavior remain untouched.

## Tests and disposable PostgreSQL gate

`tests/support/novarock-review-draft-fixture.ts` supplies test-only synthetic DB
artist IDs with deliberately synthetic card URLs. These are unverified input
claims, never production bindings or approvals. The 19 pure tests cover valid
shape, later-card digest changes and invalid cardinality, reused identity/URL,
billing/position, aliases, URLs/dates, scope/IDs, baseline duplicates, sparse arrays
and injected reviewer/independent-evidence flags.

`tests/novarock-review-draft.e2e.test.ts` uses real Prisma/PostgreSQL, with the
existing local-disposable guard before connecting and additional empty-table
checks scoped to the Nova slug/exact fixture IDs (unrelated migration seeds are
retained). It creates 44 synthetic existing identities, one exact-ID source/edition,
the three-entry baseline and a real persisted REVIEW candidate/seal. Tests cover
non-authorizing success, read-only replay and simultaneous validation, expiry,
unknown/revoked reviewer, bad digest, unknown/reused/stale artist, late card changes,
source/lease/generation/URL drift, competing source, mutable date/position/alias
baseline, catalogue-wide alias collision and a newer failed attempt. Deterministic
writer-first source and edition races observe `pg_blocking_pids`, verify actual
Serializable isolation and require SQLSTATE 40001/P2034, followed by a fresh retry.
The edition retry succeeds after fixture restoration; the source retry stays
stale after a committed cadence change and field restoration because generation
has advanced twice. Source generation is never reset: individual stale-source
and lease cases run the actual validator in the same real Serializable transaction
as their synthetic mutation, then deliberately roll the transaction back. The
URL swap-away/back case asserts two trigger-generated increments before rollback.
The suite compares complete catalogue snapshots and **global** publication,
playlist-refresh, playlist, festival, edition, artist and lineup counts before/after,
and checks original REVIEW lineage. Global snapshot rows are ordered by ID.
Race mutations belong only to test setup; the source race restores its config
field while retaining the monotonic generation. The application validator performs
no writes. Seal fixtures remain append-only: discard the DB.

Controller: provision a NEW empty disposable localhost PostgreSQL database whose
name contains `test` or `integration`, set its DATABASE_URL in your own environment,
then run:

```sh
npx prisma migrate deploy
node --import tsx tests/novarock-review-draft.e2e.test.ts
```

Do not share this database with the seal/provenance suites. Do not use production
URLs or stored credentials. This suite does not establish review decision INSERT,
append-only decision enforcement, authenticated route or publication acceptance.

Local verification: normal `npm run typecheck` (including Prisma generation) uses
`XDG_CACHE_HOME=/tmp/rockharz-prisma-cache` to avoid the default read-only Prisma
cache. Draft tests: 19 passed. Existing seal tests: 9 passed. Focused regressions: Nova parser 7, policy 3, publication 2, review queue
19 passed/1 sandbox skip, Rockharz 12 and admin-auth 2 passed. Total: 73 passing
tests and one existing sandbox skip across these suites and the draft/seal suites.

The Codex sandbox could not run PostgreSQL (Docker socket permission denied, no
local server binaries; optional binary download hit DNS `EAI_AGAIN`). The
controller provisioned a separate disposable PostgreSQL 16 database bound to
localhost, applied all 24 migrations, and independently ran the corrected
real-database suite: 19/19 passed, including source/edition serialization
races and unchanged global catalogue/publication/playlist counts. No
production database or credential was used.

Controller feedback: the initial PostgreSQL 16 run failed before any fixture
writes because migrations seed an unrelated Midgardsblot festival. The same-branch
fixture correction replaces global-empty catalogue assertions with exact Nova
slug/ID nonexistence guards, supplies the competing source's explicit required
fields/configuration, and respects the database generation trigger through rollback
and real config edits. After correction, typecheck and the 19 draft plus 9 seal
unit tests passed locally. The controller's corrected PostgreSQL rerun passed
19/19 on the isolated localhost database.

The Codex sandbox could not stage through linked Git metadata (`index.lock`
was read-only). The controller independently reviewed and committed this scoped
code/documentation/test change after PostgreSQL validation. No production
source, catalogue row, playlist queue or deployment is modified by this PR.
