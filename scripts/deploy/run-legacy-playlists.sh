#!/usr/bin/env bash
set -euo pipefail
# Called only by the locked dispatcher. Never start an independent provider job.
[[ "${PLAYLIST_LOCK_HELD:-}" == true ]] || { echo 'playlist lock required' >&2; exit 2; }
scope="${1:-}"
app_root="${APP_ROOT:-/opt/festival-radar}"
current="$app_root/current"
output="$app_root/shared/collection-jobs/playlists"
work="$output/work"
umask 077
install -d -m 0700 "$work"
cd "$work"
"$current/.runtime/node" "$current/scripts/export-playlist-catalog.mjs" "$work/tmp/festival-playlist-catalog.json"
FESTIVAL_CATALOG="$work/tmp/festival-playlist-catalog.json" FESTIVALS="$scope" "${PLAYLIST_PYTHON:-python3}" "$current/scripts/spotify_gmm_2026/festival_playlists.py"
if [[ -n "$scope" ]]; then export PLAYLIST_STATUS_MERGE=1; else export PLAYLIST_STATUS_MERGE=0; fi
"$current/.runtime/node" "$current/scripts/build-playlist-status.mjs" "$work/outputs/festival_playlists" "$output/playlist-status.json" "$work/outputs/youtube_music"
