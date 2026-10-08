This is a one-shot **UPDATE of the existing Rockharz Open Air 2027 edition**.
Base: `58abc7c9c93f00535131f2fc4b7164335cd15630`. No festival or edition
is created. No production execution, merge, deployment, playlist publication or
secret provisioning is part of this change.

The API executes under the application's existing Prisma/DB authority. The
runner only uses HTTPS; it receives neither a database connection nor SSH access.
The deployment account cannot read `production.env` or the DB, and its sudo
allowlist only exposes `activate-release` / `upgrade-deployment-assets`. Those
wrappers are unchanged. Existing shared internal API and admin session auth do
not authorize this endpoint.

Reviewed evidence (8 October 2026):

- [First wave](https://www.rockharz-festival.com/erste-bandwelle-fuer-das-rockharz-2027):
  29 announced acts, not a complete lineup. The fixed plan imports 26 names.
- [Bands](https://www.rockharz-festival.com/bands): independent host read-only curl
  inspection on 8 October verified exactly **29 titled HTML image tiles**, including
  `DARTAGNAN`, `GRAVE DIGGER`, and `SKALD`. The article differs with `GRAVE DIIGGER`,
  prose `D’ARTAGNAN`, and `SKĀLD` / `SKÀLD`. Those three acts remain omitted because
  existing canonical identity spellings require review, rather than lack of tile
  access. The article typo is never created. Other verified title differences are
  `IGELS VS. SHARK`, `SETYOURSAILS`, and `STORMSEEKER`. The plan retains the article
  spellings for those acts only when an existing exact case-insensitive identity
  is unambiguous; it cannot create a new identity from these disputed spellings.
  Tile verification, differences, omissions and reasons are persisted in the plan/audit.
- [Headliner announcement](https://www.rockharz-festival.com/headliner-alarm):
  Amon Amarth explicitly confirmed as HEADLINER, independently of `/bands`.
  With this act the imported subset totals **27 announced: 1 headliner + 26 lineup**.
- [Official marketplace](https://ticketmarktplatz.rockharz-festival.com/):
  7–10 July 2027, Ballenstedt; marketplace opens early 2027.
- [Sold-out announcement](https://www.rockharz-festival.com/das-rockharz-2027-ist-ausverkauft):
  festival tickets unavailable. Marketplace registration does not imply available tickets.

The plan expires at **2026-10-09 13:45 UTC** before the promised next band wave.
Inspection and activation after expiry abort. Readback remains available. A later
activation needs a reviewed code change updating the evidence, names and deadline;
it must never just bypass the deadline. The plan hash binds the fixed subset,
omissions, evidence URLs, dates, statuses and review window.

Activation procedure (future operator action; not executed here):

1. Review and release the code through the normal protected process. Configure
   the GitHub `production` environment with required reviewers and deployment
   branch restriction to `main`; these controls cannot be created by YAML.
2. Provision a **dedicated random 64-character lowercase hex** production
   environment secret `ROCKHARZ_2027_UPDATE_TOKEN`. Do not reuse
   `INTERNAL_API_SECRET`. Set production environment variable
   `ROCKHARZ_2027_UPDATE_ACTIVATION=UPDATE_EXISTING_ROCKHARZ_2027` only for this
   operation. The existing deploy workflow passes these optional values to the
   protected runtime environment. No secret value belongs in git, logs or artifacts.
3. Ensure the released application's `DEPLOYED_COMMIT` exactly matches the full
   workflow SHA. Manually dispatch **One-shot guarded UPDATE existing Rockharz
   2027** from `main`, operation `inspect`, activation phrase
   `UPDATE_EXISTING_ROCKHARZ_2027`. Review the READY result and counts.
4. Within the review window, dispatch operation `activate` with the same exact
   phrase and deployed SHA. The client repeats inspection, activates once and
   independently reads back the committed result. Production environment approval
   applies to each dispatch. It prints only validated identifiers/counts/digests.
5. Require VERIFIED, existing edition ID, 27 announced, 1 headliner, 26 lineup,
   5 manual sources, 9 field provenance records, matching publication/audit IDs
   and **0 playlist jobs**. The DB holds `CatalogPublication` source ADMIN,
   unique key `guarded-update:rockharz:2027:v1`, and `AdminAuditEntry` action
   `ROCKHARZ_2027_GUARDED_UPDATE`, with before/after, evidence, plan hash,
   workflow run/attempt and deployed SHA.
6. If transport fails or the POST result is lost, dispatch **readback** on the
   same deployed commit. Never blindly replay activation. A committed result
   verifies; an unapplied or changed state rejects. Keep workflow logs with the
   DB audit. Revoke the dedicated secret and clear the activation variable from
   both runtime and the production environment through the normal protected
   configuration process after verification.

The endpoint is POST-only, denies missing/disabled/malformed/reused credentials,
uses constant-time comparison, bounds the JSON body and rejects extra fields.
It requires exact runtime/workflow commit, plan digest and activation phrase.
There is no generic slug, year, artist list, SQL or force option. Inspection and
readback are read-only. All activation writes, preconditions and internal readback
run in a serializable transaction (5-second acquisition / 20-second execution
limits), without automatic serialization retries. The unique publication key
and nonempty lineup reject a second activation even after credentials are reused.

Preconditions are deliberately conservative: exact slug/name, DE and official
URL; exactly one 2027/CURRENT edition; exact existing dates; TBA status and
completeness, UNKNOWN tickets; null/Ballenstedt city; null/official marketplace
ticket URL; entirely empty lineup including cancelled acts; no target timetable,
playlists, 2027 publication, pending admin changes/drafts or unresolved ingestion
candidates. **Any existing target provenance or source blocks activation**, even
if apparently compatible: this implementation does not overwrite or reinterpret
unreviewed evidence. Other editions and their sources are preserved. Existing
Rockharz playlist queue rows also block activation. A changed baseline needs a
separate review rather than loosening production guards on the fly.

Case-, punctuation- and diacritic-folded name/alias collisions, conflicting slug
owners and ambiguous identities abort. Folding uses Unicode NFKD, combining-mark
removal, explicit stroked-letter/ligature folds (including Ø), and punctuation
removal; it only detects possible collisions and never authorizes merging different
names. A single narrow catalog read is capped at 20,000 artists (one extra row
detects overflow, which aborts); in-memory indexes avoid repeated table scans.
Verified article/tile variants also act as collision keys, including IGEL/IGELS.
An unambiguous exact case-insensitive name match is reused even if
its existing slug differs from the generated slug; no artist profiles or provider
identities are overwritten. New names get UNRESOLVED identities. Only partial
lineup/status, sold-out ticket data and city are updated; dates are verified and
receive their own evidence. Headliner evidence is a separate field record.

All five sources are enabled `manual_review` only, bound to the existing edition,
with a review reason, weekly cadence and next review time. This is a human review
configuration, not an image scraper. The operation does not invoke the generic
publisher, enqueue playlist refreshes or notification outbox records, or call
Spotify/YouTube. Independently authorized future operations remain independent.

Validation:

```sh
npm run typecheck
npm run test:rockharz-update
DATABASE_URL=postgresql://test:test@127.0.0.1:5432/rockharz_update_test npm run test:rockharz-update-db
```

The integration suite refuses remote/ambiguous/non-test databases and migrates a
new random schema inside a local disposable database, dropping that schema after
tests. It checks reuse, preserved IDs, complete readback, rollback, conflicts,
replay and simultaneous activation. CI runs it against its disposable PostgreSQL
service. Production DB permissions and the live baseline are unverified here;
inspection intentionally resolves those uncertainties without mutation.

Independent host verification on 8 October: 42/42 integration cases passed on a
local disposable PostgreSQL 16 container (the random test schema was dropped);
5/5 unit/auth/client tests, `test:data`, typecheck and `git diff --check` passed.
The schema-local `digest` forwarding function handles pgcrypto already installed
in the parent CI database. A local Node 24 `next build` compiled the route, then
failed in Next.js while parsing TypeScript `--showConfig` child output (direct
`tsc --showConfig` produced valid JSON). CI runs the production build under Node
22; its result must be checked before any activation decision.
