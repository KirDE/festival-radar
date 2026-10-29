# Spotify repertoire profiles for composite live acts

A festival billing is not necessarily one Spotify artist identity. A profile
preserves the single catalogue act and its five-track budget while using N
reviewed Spotify entities to find the correct collaborative repertoire.

This is deliberately separate from `ArtistIdentity` and artist aliases. It
neither merges the participants' identities nor sums their audience metrics.

## Durable configuration

Profiles live in the existing database `OperationalState` namespace:

- `spotify-repertoire-profile:<key>` stores a versioned, validated profile.
- `spotify-repertoire-binding:<artist-slug>` binds an existing catalogue act to
  that profile, with payload `{ "profileKey": "<key>" }`.
- `spotify-repertoire-audit:<key>` records the configuration hash and evidence.

`scripts/configure-spotify-repertoire.ts` reads one profile from stdin. Without
`--apply` it validates and previews only; `--apply` creates the profile, bindings
and audit atomically. Identical replay is idempotent; conflicting profiles or
bindings and unknown catalogue acts are rejected. An existing configuration is
not silently overwritten. Revision/rebinding requires separately reviewed
migration rather than an in-place widening of an active policy.

Fields: `schemaVersion: 1`, `key`, `artistSlugs`, `setlistArtist`,
`searchArtists: [{id, name}]`, `anchorArtistIds`, `collaborationArtistIds`,
`albumIds`, and public HTTPS `sourceUrls`. All IDs are pinned 22-character Spotify
IDs; artist/album memberships must be checked from actual release credits.

## Eligibility and selection

Every selected track must credit an anchor ID, and either belong to a reviewed
album ID or also credit a reviewed collaborator ID. Therefore old studio
releases credited only to Slash can be admitted by album, while a joint release
may have two or three credits. Solo Myles Kennedy, a different same-name artist,
unrelated Slash projects and original Guns N' Roses/Alter Bridge recordings do
not become eligible merely because a participant is in the profile.

The planner reads reviewed album tracklists and participant top tracks, hydrates
full Spotify track credits, then prioritizes recent setlist titles within this
pool. Missing titles are searched using the reviewed participant names, never a
fuzzy match of the entire billing string. Remaining slots use the eligible pool,
preferring studio versions and popularity. Short, poor-version and unavailable
tracks are rejected. One shared five-track budget and the existing global URI
and song deduplication remain. Reports contain the profile key and selected
track/credit/release IDs; follower counts are not synthesized.

The DB worker and canonical exporter transport profiles to the same Python
planner. Invalid or missing bound profiles fail closed. Provider errors do not
fall back to the participants' unrestricted solo catalogs.

## Existing durable plans

Profiles are read only when discovering a new plan. Already staged plans,
unknown provider operations, creation markers and playlist bindings are never
reset or replayed by configuring a profile. Configuration itself does not enqueue
jobs or call Spotify/YouTube write endpoints. New discovery uses the profile;
replanning existing work remains a separately reconciled operation.
