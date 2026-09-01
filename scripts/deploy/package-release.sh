#!/usr/bin/env bash
set -euo pipefail

commit="${1:?usage: package-release.sh COMMIT [OUTPUT]}"
output="${2:-festival-radar-${commit}.tar.gz}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

test -f .next/standalone/server.js
mkdir -p "$stage/app/.next" "$stage/app/.runtime" "$stage/app/scripts/analytics" "$stage/app/scripts/deploy" "$stage/app/scripts/notifications" "$stage/app/scripts/spotify_gmm_2026"
cp "$(command -v node)" "$stage/app/.runtime/node"
chmod 0755 "$stage/app/.runtime/node"
cp -a .next/standalone/. "$stage/app/"
cp -a .next/static "$stage/app/.next/static"
cp -a public "$stage/app/public"
cp package.json package-lock.json "$stage/app/"
cp -a prisma "$stage/app/prisma"
cp -a data lib "$stage/app/"
cp scripts/ingest-festivals.mjs "$stage/app/scripts/"
cp scripts/resolve-artist-identities.mjs scripts/check-festival-sources.mjs scripts/export-playlist-catalog.mjs scripts/build-playlist-status.mjs "$stage/app/scripts/"
cp -a scripts/spotify_gmm_2026/. "$stage/app/scripts/spotify_gmm_2026/"
cp requirements.txt "$stage/app/"
cp scripts/deploy/reconfigure-webserver.sh "$stage/app/scripts/deploy/"
cp scripts/analytics/prune-production.sh "$stage/app/scripts/analytics/"
cp scripts/deploy/run-collection-job.sh "$stage/app/scripts/deploy/"
cp scripts/notifications/dispatch-production.sh "$stage/app/scripts/notifications/"
chmod 0755 "$stage/app/scripts/deploy/reconfigure-webserver.sh"
chmod 0755 "$stage/app/scripts/analytics/prune-production.sh"
chmod 0755 "$stage/app/scripts/deploy/run-collection-job.sh"
chmod 0755 "$stage/app/scripts/notifications/dispatch-production.sh"
printf '%s\n' "$commit" > "$stage/app/DEPLOYED_COMMIT"
tar -C "$stage" -czf "$output" app
archive_contents="$stage/archive-contents.txt"
tar -tzf "$output" > "$archive_contents"
grep -Fxq 'app/scripts/deploy/reconfigure-webserver.sh' "$archive_contents"
grep -Fxq 'app/scripts/analytics/prune-production.sh' "$archive_contents"
grep -Fxq 'app/scripts/deploy/run-collection-job.sh' "$archive_contents"
grep -Fxq 'app/scripts/spotify_gmm_2026/spotify_auth.py' "$archive_contents"
grep -Fxq 'app/scripts/notifications/dispatch-production.sh' "$archive_contents"
