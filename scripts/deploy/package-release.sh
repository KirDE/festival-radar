#!/usr/bin/env bash
set -euo pipefail

commit="${1:?usage: package-release.sh COMMIT [OUTPUT]}"
output="${2:-festival-radar-${commit}.tar.gz}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

test -f .next/standalone/server.js
mkdir -p "$stage/app/.next" "$stage/app/.runtime" "$stage/app/scripts/analytics" "$stage/app/scripts/deploy" "$stage/app/scripts/notifications" "$stage/app/scripts/spotify_gmm_2026"
"$(dirname "$0")/bundle-node-runtime.sh" "$stage/app/.runtime"
cp -a .next/standalone/. "$stage/app/"
cp -a .next/static "$stage/app/.next/static"
cp -a public "$stage/app/public"
cp package.json package-lock.json "$stage/app/"
cp -a prisma "$stage/app/prisma"
cp -a lib "$stage/app/"
cp scripts/ingest-festivals.mjs scripts/drain-ingestion-notifications.mjs scripts/export-ingestion-review-queue.mjs "$stage/app/scripts/"
cp scripts/db-due-tick.mjs scripts/report-db-due-health.mjs scripts/report-db-due-pilot.mjs "$stage/app/scripts/"
cp scripts/refresh-spotify-stats.mjs scripts/audit-final-cutover.ts scripts/import-timetable.mjs scripts/enrich-artists.mjs scripts/playlist-dispatch.ts scripts/playlist-cutover.ts scripts/playlist-worker.ts scripts/playlist-lease-guard.ts scripts/resolve-artist-identities.mjs scripts/check-festival-sources.mjs scripts/export-playlist-catalog.mjs scripts/build-playlist-status.mjs "$stage/app/scripts/"
cp -a scripts/spotify_gmm_2026/. "$stage/app/scripts/spotify_gmm_2026/"
cp requirements.txt "$stage/app/"
# The CI builder may run a newer interpreter than the production Python 3.9.
# Resolve wheels for the runtime, not for the builder; fail closed on sdists.
python3 -m pip install --disable-pip-version-check --no-input --only-binary=:all: --python-version 3.9 --target "$stage/app/.python" -r requirements.txt
cp scripts/deploy/reconfigure-webserver.sh "$stage/app/scripts/deploy/"
cp scripts/deploy/read-playlist-install-mode.ts scripts/deploy/playlist-timer-install.sh "$stage/app/scripts/deploy/"
cp scripts/analytics/prune-production.sh "$stage/app/scripts/analytics/"
cp scripts/deploy/run-legacy-playlists.sh scripts/deploy/run-collection-job.sh "$stage/app/scripts/deploy/"
cp scripts/deploy/diagnose-legacy-ingestion.mjs scripts/deploy/db-due-scheduler-assets.sh scripts/deploy/db-due-scheduler scripts/deploy/check-db-due-tick-ready scripts/deploy/run-legacy-ingestion.sh scripts/deploy/run-db-due-operation.sh scripts/deploy/start-db-due scripts/deploy/db-due-assets.sh "$stage/app/scripts/deploy/"
cp scripts/notifications/dispatch-production.sh "$stage/app/scripts/notifications/"
chmod 0755 "$stage/app/scripts/deploy/reconfigure-webserver.sh"
chmod 0755 "$stage/app/scripts/analytics/prune-production.sh"
chmod 0755 "$stage/app/scripts/deploy/run-collection-job.sh"
chmod 0755 "$stage/app/scripts/deploy/run-db-due-operation.sh" "$stage/app/scripts/deploy/start-db-due"
chmod 0755 "$stage/app/scripts/notifications/dispatch-production.sh"
if [[ "${DB_ONLY_RELEASE:-false}" == true ]]; then
  node scripts/deploy/prepare-db-only-release.mjs "$stage/app" "$commit" "${DB_ONLY_CUTOVER_AUDIT:?reviewed parity and restore audit required}"
fi
printf '%s\n' "$commit" > "$stage/app/DEPLOYED_COMMIT"
tar -C "$stage" -czf "$output" app
archive_contents="$stage/archive-contents.txt"
tar -tzf "$output" > "$archive_contents"
grep -Fxq 'app/scripts/deploy/reconfigure-webserver.sh' "$archive_contents"
grep -Fxq 'app/scripts/deploy/read-playlist-install-mode.ts' "$archive_contents"
grep -Fxq 'app/scripts/deploy/playlist-timer-install.sh' "$archive_contents"
grep -Fxq 'app/.runtime/npm/bin/npm-cli.js' "$archive_contents"
grep -Fxq 'app/.runtime/NPM_VERSION' "$archive_contents"
grep -Fxq 'app/scripts/analytics/prune-production.sh' "$archive_contents"
grep -Fxq 'app/scripts/deploy/run-collection-job.sh' "$archive_contents"
grep -Fxq 'app/scripts/deploy/diagnose-legacy-ingestion.mjs' "$archive_contents"
grep -Fxq 'app/scripts/deploy/check-db-due-tick-ready' "$archive_contents"
if [[ "${DB_ONLY_RELEASE:-false}" == true ]]; then
  if grep -Eq '^app/(data/|public/(logos|offline)/|lib/catalog/(seed|backfill|logo-import)\.ts)' "$archive_contents"; then
    echo 'dynamic catalogue leaked into DB-only archive' >&2; exit 1
  fi
fi
grep -Fxq 'app/scripts/drain-ingestion-notifications.mjs' "$archive_contents"
grep -Fxq 'app/scripts/export-ingestion-review-queue.mjs' "$archive_contents"
grep -Fxq 'app/lib/ingestion/review-queue.mjs' "$archive_contents"
grep -Fxq 'app/scripts/spotify_gmm_2026/spotify_auth.py' "$archive_contents"
grep -Eq '^app/\.python/(requests|ytmusicapi)/' "$archive_contents"
grep -Fxq 'app/scripts/notifications/dispatch-production.sh' "$archive_contents"

grep -Fxq 'app/scripts/audit-final-cutover.ts' "$archive_contents"
grep -Fxq 'app/scripts/playlist-cutover.ts' "$archive_contents"
grep -Fxq 'app/scripts/playlist-dispatch.ts' "$archive_contents"
grep -Fxq 'app/scripts/deploy/run-legacy-playlists.sh' "$archive_contents"
