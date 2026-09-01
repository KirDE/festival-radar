#!/usr/bin/env bash
set -euo pipefail
job="${1:?usage: run-collection-job.sh JOB}"
app_root="${APP_ROOT:-/opt/festival-radar}"
app_url="${COLLECTION_APP_URL:-http://127.0.0.1:${PORT:-3100}}"
umask 027
shared="$app_root/shared"
current="$app_root/current"
output="$shared/collection-jobs/$job"
install -d -m 0750 "$output"
cd "$current"
case "$job" in
  ingestion)
    printf '{"festival":null,"force":false}\n' > "$output/request.json"
    curl --fail --silent --show-error --max-time 1200 -H "authorization: Bearer ${INTERNAL_API_SECRET:?missing INTERNAL_API_SECRET}" -H 'content-type: application/json' --data-binary "@$output/request.json" "${app_url%/}/api/ingestion/run/" > "$output/latest.json.tmp"
    grep -Eq '"status":"(COMPLETED|PARTIAL)"' "$output/latest.json.tmp"
    mv -f "$output/latest.json.tmp" "$output/latest.json" ;;
  artist-identities)
    IDENTITY_STATE_PATH="$output/state.json" IDENTITY_BATCH_SIZE="${IDENTITY_BATCH_SIZE:-20}" "$current/.runtime/node" scripts/resolve-artist-identities.mjs > "$output/latest.json.tmp"
    mv -f "$output/latest.json.tmp" "$output/latest.json" ;;
  source-monitor)
    "$current/.runtime/node" scripts/check-festival-sources.mjs > "$output/latest.json.tmp"
    mv -f "$output/latest.json.tmp" "$output/latest.json" ;;
  playlists)
    "$current/.runtime/node" scripts/export-playlist-catalog.mjs
    "${PLAYLIST_PYTHON:-python3}" scripts/spotify_gmm_2026/festival_playlists.py
    "$current/.runtime/node" scripts/build-playlist-status.mjs
    cp data/playlist-status.json "$output/playlist-status.json.tmp"
    mv -f "$output/playlist-status.json.tmp" "$output/playlist-status.json" ;;
  *) echo "unsupported collection job: $job" >&2; exit 2 ;;
esac
