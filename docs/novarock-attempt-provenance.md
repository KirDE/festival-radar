# Acquisition provenance prerequisite (2026-10-08)

This implements only the first prerequisite in the sibling
`../novarock-guarded-publication/docs/novarock-2027-publication-design.md`.
It adds no reviewed publisher, approval record, source activation or provider work.

## Persistence contract

`IngestionAttempt.acquisitionProvenance` is a nullable, versioned JSON snapshot.
DB-due claims return the exact updated source row and bound edition identity in
one PostgreSQL statement. The worker maps, fetches and extracts from that returned
row; it never rereads configuration after claim to construct provenance. Attempt
persistence accepts the snapshot and validates its digest, slug and requested URL.
Both successful extraction (including REVIEW/UNCHANGED) and fetch failure attempts
retain it. The existing requestedUrl and finalUrl columns retain acquisition URLs;
finalUrl is unknown/null if fetching never obtains a response. Fixture attempts
retain their existing synthetic final URL convention and absent HTTP status;
fixtures are not independent HTTP acquisition proof.

The snapshot binds source ID, festival ID/slug, edition ID/year/record state,
configured URL, parser key, ordered strategies, fetchUrl, followLinkPattern,
request headers, enabled flag, refresh policy, cadence, manual-review reason and
configuration-backfill timestamp. SHA-256 uses recursive lexically sorted object
keys and unchanged array order. Header insertion order does not change the digest.
Operational health, HTTP validators, scheduling, heartbeat expiry and updatedAt
are excluded. `claimedAt` retains updatedAt as audit metadata only.

A database trigger increments `FestivalSource.configurationGeneration` whenever
any source configuration field above changes. No-op updates preserve it; setting
the generation directly cannot reset it. URL swap-away/back changes generation
even when digest and updatedAt are unchanged. Claim increments `leaseVersion`
atomically, separately from configuration generation, and records version and
random owner in the attempt. Existing renewal/completion/publication fences remain
in place. Source generation starts at 1 and lease version at 0; this does not
attest any pre-migration history.

No foreign keys tie the snapshot to mutable source/edition rows: changing or
deleting live configuration cannot rewrite historical acquisition identities.
Historical and unleased/manual attempts remain null; never synthesize proof from
present configuration. `readAcquisitionProvenance` rejects absent, malformed,
unknown-version, extra-field and digest-mismatched payloads. This is necessary
for future reviewed eligibility, never sufficient publication authority.

## Required future locked recheck

A future reviewed route must lock the exact source and bound festival/current
edition, then reread and compare every configuration field/digest, generation and
lease version to the persisted acquisition. `acquisitionMatchesSource` is only a
comparison primitive; it also rejects a different active owner and permits a
completed/quiescent lease with the same version. The caller must separately
validate expiry or explicitly require quiescence, CURRENT state and exact Nova
Rock 2027 IDs/year, requested **and final** direct official lineup URLs, HTTP
success, no fallback/follow-link/alternate-fetch and independently attested parser
revision. Do not use updatedAt alone as configuration generation.

That route also needs the design's locked approval, catalogue snapshot, complete
candidate/evidence/diff integrity and newer-attempt checks (including failed and
placeholder attempts), plus atomic identity/billing writes and provider deferral.
JSON/digest validation is not an immutability mechanism or parser attestation.
Current REVIEW refusal and ordinary publication behavior are unchanged. Non-Nova
and ARCHIVED/TRACKING source snapshots use the same additive contract without
introducing Nova-specific ingestion gates.

## Verification on disposable PostgreSQL

Passed: four provenance unit tests; 51 focused parser, policy, publication,
review-queue, source recovery, follow-link and configuration tests; Prisma generate,
Prisma validation and normal `npm run typecheck`. One existing review-queue CLI
child-process test skipped itself because its sandbox prohibits that invocation.

The controller provisioned an isolated PostgreSQL 16 container on localhost
(`novarock_provenance_test`), applied all 23 repository migrations including the
new provenance migration, and ran E2E suites independently (not concurrently):

- New Nova provenance E2E: 1/1 passed on an empty migrated database; source
  swap/rebind, reclaimed lease and no publication/Spotify refresh verified.
- After seeding the disposable catalogue with `npm run test:seed`, DB-due
  worker: 13/13 passed, including persisted provenance on a non-Nova attempt.
- Lease fencing: 10/10 passed; ingestion repository: 1/1 passed.

The new E2E intentionally requires an empty migrated database; the worker test
requires a synthetic seeded catalogue. An initial concurrent run on the empty
database failed for missing catalogue content and shared-state interference.
After seeding, the existing suites passed sequentially. No production target was
consulted or mutated. These tests validate acquisition provenance only; reviewed
publication and its transaction E2E remain unimplemented.

## PR scope

This prerequisite is not a Nova publication route. Do not merge or deploy it as
if it authorized activating the source, approving a candidate or publishing
the catalogue. Reviewed approval, complete 44-card identity bindings and
transactional publication E2E remain separate work.
