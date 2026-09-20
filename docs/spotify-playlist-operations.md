# Spotify playlist operations

The `Refresh festival playlists` workflow is manually dispatchable and calls
the protected production API. Production exports the committed PostgreSQL
catalogue, refreshes provider playlists, validates provider read-back, and
commits verified playlist metadata to PostgreSQL transactionally. Repository
status JSON is a seed/test fixture and is never mutated by production.

## Credentials and rotation

The repository Actions secrets are `SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN`. Never put their values in
the repository, workflow output, issues, or pull requests.

Rotate the client secret and refresh token together from the Spotify developer
dashboard and the repository's Actions secrets page:

1. Generate a new client secret and complete OAuth authorization for the
   dedicated playlist account with only the two playlist modification scopes.
2. Replace all three repository Actions secrets. Keep the previous client
   secret valid until verification is complete when Spotify permits overlap.
3. Manually dispatch `Refresh festival playlists` and confirm the refresh and
   status-build steps succeed and the proposed metadata contains HTTPS Spotify
   playlist URLs, non-negative artist/track counts, and current timestamps.
4. Revoke the previous secret/token and dispatch the workflow once more.

Rotate immediately after suspected disclosure or maintainer access changes,
and otherwise at least every 90 days. Record the rotation date, never the
secret value, in the private operations log.

## Failure alerting and recovery

Repository administrators should watch failed Actions runs and enable GitHub
email or web notifications for Actions failures. A red `Refresh festival
playlists` run is the operational alert; inspect the first failed step before
retrying.

- Authentication errors: rotate the client secret and refresh token, then run
  a manual verification.
- Spotify `429` responses: respect `Retry-After`; do not launch overlapping
  manual runs. Workflow concurrency already serializes refreshes.
- Upstream/setlist failures: retry after the provider recovers and verify that
  no incomplete status PR is merged.
- Database status update failure: inspect the durable playlist refresh request,
  provider read-back artifact, and application log before retrying.

After a refresh, open each affected festival page and confirm the Spotify link
and artist/track counts match the production API response.
