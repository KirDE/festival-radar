# Festival Radar

Festival Radar is a public discovery app for European rock and metal festivals,
with dates, lineups, official ticket links, artist pages, playlists and setlists.
It also contains the playlist-generation engine that seeds listening links from
recent setlist.fm songs and streaming-platform catalogue matches.

The static MVP for [festivals.kir-it.de](https://festivals.kir-it.de) includes 50 European festivals,
filterable cards, festival details, artist pages and links to official ticket,
Spotify and setlist.fm resources.

## Web app

```bash
npm install
npm run dev
```

Production build:

```bash
npm run typecheck
npm run test:data
npm run build
```

Account and sync API routes require a Next.js server deployment plus PostgreSQL:

```bash
cp .env.example .env
npx prisma migrate deploy
npm run dev
```

Run the route-level integration suite against an isolated PostgreSQL database
after applying the migrations:

```bash
DATABASE_URL=postgresql://festival:festival@127.0.0.1:5432/festival_integration \
  npx prisma migrate deploy
DATABASE_URL=postgresql://festival:festival@127.0.0.1:5432/festival_integration \
  npm run test:integration
```

The suite resets only the database named by `DATABASE_URL`, starts a local
Next.js server, and mocks Spotify OAuth and Web API traffic. Never point it at
a shared or production database. CI provisions a fresh PostgreSQL 16 service
for every job before running this required check.

The account API uses 30-day opaque, hashed database sessions in an HTTP-only
cookie. `PUT /api/sync/{favorites|collections|saved-filters|plans}` provides
optimistic concurrency through a required revision number; stale writes return
409. Plans can be shared using expiring, unguessable links via `/api/share`.
Authenticated users can connect Spotify at `/api/spotify/connect`; refresh
tokens are encrypted at rest using `AUTH_SECRET`, and `/api/spotify/sync`
imports their owned/followed playlists into the collections sync document.

Production runs as a Next.js standalone server behind Apache, managed by
systemd, with PostgreSQL-backed account APIs. The deploy workflow packages the
exact `main` commit together with the supported Node.js 22 runtime, runs
`prisma migrate deploy`, atomically switches the `/opt/festival-radar/current`
symlink, and restores the previous release if the
database-aware health check fails. The public deployed revision is available
from `/api/health/deployment/`.

The GitHub `production` environment must define `DEPLOY_HOST`, `DEPLOY_PORT`,
`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`,
`SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET`. Values are written to a
root-owned mode-0600 environment file on the server and are never committed or
printed. The configured SSH principal is root because the installer manages
systemd and the Plesk Apache vhost include.
Provision the initial least-privilege PostgreSQL database and role once on the
server (the password is read only from the environment):

```bash
sudo FESTIVAL_DB_PASSWORD='<generated secret>' \
  bash scripts/deploy/bootstrap-postgres.sh
```

Store the resulting connection string as the protected `DATABASE_URL` secret.
The bootstrap is idempotent; subsequent schema updates are applied by the
checked-in Prisma migrations.

Festival seed data lives in `data/festivals.ts`. Official source availability
and the setlist.fm API are checked automatically every three days by GitHub
Actions.

Festival ingestion runs daily and selects sources according to their adaptive
daily, three-day, weekly, or archived cadence. Run one source with
`npm run ingest -- --slug=wacken-open-air`; add `--due` to select only sources
whose last successful check is older than its configured interval. Scheduled
runs publish policy-approved additive changes into
`data/ingestion-publications.json` through an automatically generated pull
request. Every observation is appended to `data/ingestion-history.jsonl` with
source URL, fetch time, old/new values and outcome. Destructive, ambiguous and
date changes are recorded as `review_required` and never auto-published. Dry
runs record evidence without changing the overlay. Roll back by reverting the
generated PR (or its overlay/history entries) in a new PR.

Stage schedules use a separate provenance-aware reviewed import because official
running orders are often published later and change rapidly. See
[`docs/timetables.md`](docs/timetables.md) for validation, conflict handling,
cancellations, timezone rules and the atomic import procedure.

## Privacy analytics

Set `NEXT_PUBLIC_ANALYTICS_ENDPOINT=/api/analytics/page-view/` in the production
build and provide a random `ANALYTICS_OPERATOR_TOKEN` only to operators. The
browser sends exactly `{ "path": "/path-without-query", "locale": "en" }`
on the initial page and each distinct client-side route. It sends no cookies,
identifier, referrer, query string or URL fragment, uses credential-free
requests, and is disabled when DNT or Global Privacy Control is enabled. This
aggregate, non-identifying measurement is the documented consent policy; the
site does not set analytics cookies or build visitor profiles.

The receiver stores only daily `path`/`locale` counters in PostgreSQL. Set
`ANALYTICS_RETENTION_DAYS` (90 by default) and run `npm run analytics:prune`
daily. Reverse-proxy access logging for `/api/analytics/page-view` must be
disabled so IP addresses are not retained outside this schema. Operators can
verify accepted counts without visitor data:

```bash
curl -fsS -H "Authorization: Bearer $ANALYTICS_OPERATOR_TOKEN" \
  "https://festivals.kir-it.de/api/analytics/page-view/?days=7"
```

The response contains only the time window, total views and aggregate rows.
Production verification is complete when a test page view returns HTTP 204,
the total increments once after one route transition, and the database has no
analytics rows older than the configured retention window.

## Main scripts

- `scripts/export-playlist-catalog.mjs` exports all normalized festivals for the single current edition.
- `scripts/spotify_gmm_2026/festival_playlists.py` builds playlists from that catalog, rejects mixed/wrong editions before mutation, and writes explicit empty-lineup skips to `_catalog_summary.json`.
- `scripts/spotify_gmm_2026/spotify_auth.py` - Spotify OAuth token loading and refresh.
- `scripts/spotify_gmm_2026/init_spotify_auth.py` - exchanges a Spotify callback `code` for local tokens or refreshes the token file.
- `scripts/spotify_gmm_2026/init_youtube_music_auth.py` - starts YouTube Music OAuth device-flow and saves local tokens.
- `scripts/spotify_gmm_2026/youtube_music_transfer.py` - transfers a generated festival report to YouTube Music.
- `scripts/refresh-youtube-music-playlists.py` - refreshes every eligible persisted YouTube Music playlist independently and records per-provider failures.

## Setup

Copy `.env.example` to `.env` and fill the required values:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SETLIST_API_KEY=...
```

Then export the variables before running the scripts.

Spotify tokens are stored locally in `tmp/spotify_tokens.json` by default and are intentionally ignored by git.

## Auth

Use a Spotify authorization URL with the scopes:

```text
playlist-modify-public playlist-modify-private
```

After approving access, pass the callback `code` to:

```bash
python3 scripts/spotify_gmm_2026/init_spotify_auth.py "<code>"
```

## Build playlists

Export the canonical catalog first. Set `FESTIVAL_SEASON` to enforce the expected edition; a mismatch aborts before Spotify is changed.

```bash
npm run playlists:catalog
```

```bash
python3 scripts/spotify_gmm_2026/festival_playlists.py
```

Reports are written to `outputs/festival_playlists/`.

## Transfer to YouTube Music

YouTube Music credentials are read from `/home/openclaw/.openclaw/credentials/youtube-music.json` by default:

```json
{
  "api_key": "...",
  "client_id": "...",
  "client_secret": "..."
}
```

Use an OAuth client of type `TVs and Limited Input devices` from a project where YouTube Data API v3 is enabled. Then start device-flow auth:

```bash
python3 scripts/spotify_gmm_2026/init_youtube_music_auth.py
```

The token is saved privately to `/home/openclaw/.openclaw/credentials/youtube-music-oauth.json`.

Dry-run the Summer Breeze transfer and write an audit report:

```bash
python3 scripts/spotify_gmm_2026/youtube_music_transfer.py
```

Publish a new YouTube Music playlist after OAuth is ready:

```bash
python3 scripts/spotify_gmm_2026/youtube_music_transfer.py --publish
```

YouTube Data API quota is counted in units, not requests. Playlist item inserts cost 50 units each, so the default publisher caps each run at 190 new items and reports the remaining count.

Resume an existing YouTube Music playlist after the daily quota resets:

```bash
YOUTUBE_MUSIC_PLAYLIST_ID=... python3 scripts/spotify_gmm_2026/youtube_music_transfer.py --publish --resume-publish
```

The scheduled workflow requires three encrypted repository secrets:
`YOUTUBE_MUSIC_CREDENTIALS_JSON`, `YOUTUBE_MUSIC_OAUTH_JSON`, and
`YOUTUBE_MUSIC_PLAYLIST_IDS` (a JSON object mapping canonical festival slugs to
persisted playlist IDs). Missing IDs fail closed so an unattended retry cannot
create duplicate playlists. A failure for one festival is recorded without
preventing later festivals from being attempted; the job itself remains failed
until every eligible provider refresh succeeds.

For unattended quota checks, use the auto-resume wrapper. It first verifies that the playlist can be read, then runs the same quota-capped resume publish and prints one JSON line for each step:

```bash
YOUTUBE_MUSIC_PLAYLIST_ID=... python3 scripts/spotify_gmm_2026/youtube_music_auto_resume.py
```

Pass `--update-metadata` only when the playlist title or description needs to be rewritten. Use `--max-new-items -1` to disable the safety cap.
