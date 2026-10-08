# Nova Rock content seal: integrity prerequisite, no approval

Based on `8ad679c5` (PR #285 acquisition provenance prerequisite), with the sibling
`novarock-guarded-publication/docs/novarock-2027-publication-design.md` inspected
read-only. PR #285 remains separate. This is the explicitly permitted smaller
deliverable, **not a review authority primitive or publication authorization**.
No actual candidate is sealed or approved by this change.

## Implemented contract

`sealNovaRockContent(db, candidateId)` reads persisted records only, in a
Serializable transaction with run/attempt/candidate row locks and revalidation.
It accepts no replacement facts, reviewer label or approval text. There is no
CLI, API endpoint, scheduler integration, approval fixture, lifecycle transition
or publication route. `verifyNovaRockContentSeal(db, sealId)` independently reads
and recomputes persisted content in a fresh transaction and returns
`authority: "NONE"`. No consumer may interpret this result as approval.

The v1 canonical SHA-256 payload binds complete normalized candidate JSON,
ordered four-headliner/40-support arrays, warnings, normalized evidence, every
persisted evidence and diff ID/value/excerpt/hash/source/timestamp, diff review
flags and policy version, immutable candidate columns, all attempt/run columns, parser versions and
complete PR #285 acquisition provenance (configuration digest/generation and
lease owner/version included). Object keys and evidence/diff rows are sorted;
all other array ordering is preserved. Canonical v1 uses JavaScript UTF-16 key
ordering and permits finite safe integer JSON numbers only. It rejects unknown
fields, sparse arrays and non-JSON values. Missing, extra, replaced or changed
rows cause reader failure even when their old excerpt hashes still match.

Only extractor v1, adapter `festival-extractor-v1`, ingestion policy
`2026-08-29`, Nova 2027 CURRENT acquisition, exact requested/final lineup URL,
HTTP 200, direct `official_markup:nova-rock` with a sole official_markup strategy,
June 9–12, nonpublishable candidates with REVIEW attempts and completed/partial
finished runs are accepted. Creation requires the candidate to be PENDING under
its row lock (also enforced by the seal-insert DB trigger). Replay and verification
accept later lifecycle states while still returning authority NONE. There must be exactly four unique evidence fields matching
the full normalized values, sources, timestamps and original excerpt hash input
convention. Oversized excerpts cannot be silently truncated into eligibility.
Exactly 44 distinct observed names after NFC/case normalization are required.
This checks observed names, **not resolved artist IDs**.

The latest attempt check conservatively covers *all* Nova attempts, including
failures, null-provenance historical attempts and placeholders, regardless of
URL/generation; tied latest timestamps fail closed. A subsequent attempt makes
an existing seal ineligible on fresh read. The seal persists as historical
integrity evidence. Seal creation/replay and verification can raise a PostgreSQL
serialization error; callers must obtain a fresh transaction, never skip checks.

`NovaRockContentSeal` has a unique candidate key, restrictive FK, version/digest
checks and update/delete/truncate rejection triggers. Sealing freezes candidate
content, attempt and finished run, and prevents evidence/diff insertion,
reparenting, update or deletion for that candidate. Other ingestion rows retain
normal behavior. The five candidate lifecycle columns `reviewState`, `reviewActor`,
`reviewedAt`, `publishedAt`, and `catalogueVersion` are explicitly excluded from
the sealed snapshot/digest. The candidate DB trigger allows an UPDATE only when
all columns other than these five are unchanged, so mixed lifecycle/content
writes fail. New columns are immutable by default. Lifecycle-only updates,
including APPROVED/PUBLISHED enum values, preserve seal integrity and convey no
approval authority; no transition endpoint is introduced here. Run finalization must occur before sealing: later run counter
updates are intentionally refused. Truncating linked tables while any seal exists
is refused. Child writes acquire the candidate lock, coordinating with seal
creation; Serializable isolation additionally protects row-set reads. Privileged
DB owners capable of disabling triggers are outside this integrity boundary.
The disposable DB must be discarded; tests do not delete immutable history.

## Explicit remaining blockers

- No authenticated reviewer authorization, identity/expiry, independent raw-card
  verification, deployed extractor attestation, catalogue-only/Spotify-deferred
  review scope or append-only approval decision exists. An arbitrary caller can
  request an integrity seal; doing so grants no authority.
- No 44 name-to-artist-ID bindings, duplicate artist-ID checks, artist aliases,
  versions or independent caption/URL/day evidence are implemented. The unchanged
  parser does not persist each card's URL/day. The seal binds all information
  currently persisted; it cannot recover omitted raw evidence.
- No exact production source/festival/edition ID restriction, locked current
  source generation/lease/quiescence checks, competing-source inventory,
  catalogue baseline/target dates/billing/row versions, or independently
  recomputed baseline diff contract is implemented. Provenance is internally
  validated and digest-bound, but source freshness is not established.
- `sourceCommit` is digest-bound text, not trusted deployed-parser attestation.
  Warnings and supported-version diffs are integrity-bound, not policy-approved.
- No catalogue writer, billing correction, publication replay, Spotify queue or
  provider work exists. APPROVED alone remains insufficient.
- The controller applied all 24 migrations to a fresh disposable localhost
  PostgreSQL 16 database and ran the corrected E2E: 1/1 passed, including
  lifecycle-only transitions, rollback, immutable content, newer attempts and
  TRUNCATE rejection. The first version also passed 1/1 on a separate disposable
  DB. Dedicated concurrent seal/child-row and serialization coverage is now
  supplied in `tests/novarock-content-seal-concurrency.e2e.test.ts` and passed
  16/16 including the parent test on a fresh migrated disposable localhost
  PostgreSQL 16 database. No production DB was used.

## Verification and controller commands

Local Prisma validate (using a dummy localhost URL, no connection), generate and
`npm run typecheck` passed. Nine seal unit tests passed; provenance (4), Nova parser
(7), policy (3), ingestion publication (2), review queue (19 passed/1 sandbox
skip), and Rockharz parser (12) regressions passed. No production database was
accessed. The concurrency follow-up passed typecheck (including Prisma generate)
and all nine seal unit tests locally. The controller provisioned a separate
localhost PostgreSQL 16 container, migrated a new empty test database and ran
the concurrency suite successfully (16/16). An initial test run failed solely
because Prisma bound a PID query parameter as bigint instead of PostgreSQL int;
the test query now casts both PIDs explicitly. The passing run used another
fresh empty migrated database, with no production connection. The Codex sandbox
could not stage via its read-only linked-worktree Git metadata, so the controller
committed the scoped diff.

```sh
# Validation uses this URL only for schema loading and never connects.
DATABASE_URL=postgresql://localhost:5432/novarock_test npx prisma validate
npx prisma generate
npm run typecheck
node --import tsx tests/novarock-content-seal.test.ts
```

Controller: provision a **new empty disposable localhost** PostgreSQL database,
set its `DATABASE_URL` (database name must contain `test` or `integration`), then:

```sh
npx prisma migrate deploy
node --import tsx tests/novarock-content-seal.e2e.test.ts
```

The E2E guard executes before Prisma connects. It checks persisted seal replay,
concurrent duplicate creation, unique constraints, linked-row/extra-row/append-only/truncate rejection, rollback,
PENDING-only creation, APPROVED/PUBLISHED lifecycle-only updates with unchanged
seal and authority NONE, rejection of normalized/warnings/lineage and mixed
updates, newer failed-attempt invalidation, and unchanged global
publication/Spotify refresh counts. Discard that disposable database afterwards.
Use a separate empty disposable database for PR #285 provenance E2E:

```sh
npx prisma migrate deploy
node --import tsx tests/ingestion-provenance.e2e.test.ts
```

This migration is a prerequisite under review, not a publication approval. The
snapshot contract excludes lifecycle metadata; older provisional snapshots that
contain it fail closed. Never rewrite persisted seals or backfill approval.

## Deterministic concurrency follow-up

Run the new concurrency suite on its **own fresh empty migrated disposable
localhost DB**, separately from the sequential E2E above (append-only fixtures
are intentionally retained). The local-disposable URL guard runs before Prisma
connects. The suite rejects existing ingestion attempts, runs or seals.

```sh
# Set DATABASE_URL to the NEW disposable localhost test/integration database.
npx prisma migrate deploy
node --import tsx tests/novarock-content-seal-concurrency.e2e.test.ts
```

There are 15 sequential race subtests plus the parent test:

- Evidence and diff INSERT, UPDATE and DELETE, each in both orderings (12).
  Seal-first pauses the actual application after seal INSERT while its
  transaction/locks remain open. A competing Serializable writer takes a
  pre-seal snapshot, attempts the mutation and is observed blocked by the seal's
  backend through `pg_blocking_pids`. Releasing the seal must commit one valid
  seal and reject the stale writer with an immutable-content or serialization
  error. All candidate/evidence/diff rows must remain unchanged and verification
  must return authority NONE.
  Writer-first pauses after the child mutation has acquired the candidate lock.
  The actual sealer reads its pre-commit snapshot, then is observed blocked by
  that writer. Once the writer commits, the stale sealer must propagate a
  serialization error and persist no seal. Only the unsealed mutation may commit.
- Mixed lifecycle/content UPDATE in both orderings (2). The single statement
  changes synthetic untrusted actor text together with normalized and persisted
  warnings. It cannot camouflage content changes after sealing. Losing writes
  roll back the entire statement; a winning pre-seal writer invalidates the
  competing stale sealer.
- Explicit serialization failure and fresh retry (1). After the application's
  first candidate read, a separate transaction changes only synthetic actor
  metadata. The candidate FOR UPDATE must fail on the stale Serializable
  snapshot, with no seal and PENDING unchanged. Only an explicit new application
  transaction may then seal the unchanged content, still with authority NONE.

Test-only proxies pause real Prisma calls; they do not substitute table doubles,
change transaction options or reproduce the sealer in test code. The suite checks
both the application-supplied Serializable option and PostgreSQL's actual
`SHOW transaction_isolation`. Only Prisma P2034 or raw-query P2010 with SQLSTATE
40001 qualifies as serialization failure; deadlocks, timeouts and unrelated
errors do not satisfy that assertion. Barrier and lock-observation deadlines are
five seconds, transactions ten seconds, subtests fifteen seconds. Lock polling
waits on an observed database condition, never a fixed scheduling delay. Finally
blocks release barriers, await both transaction outcomes and disconnect.

Global publication and Spotify refresh counts must stay unchanged. This suite
creates no approval decision, catalogue publication or provider activity. The
existing migration/runtime implementation is unchanged: no fail-open bug was
demonstrated by the 15 PostgreSQL-validated race scenarios (16/16 including
parent). Coverage is limited to
Serializable competing writers and the specified application lock order; this
is not acceptance of other transaction isolation levels, reparenting races,
source/catalogue freshness or review authorization.
