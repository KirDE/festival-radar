#!/usr/bin/env bash
set -euo pipefail
mode="$1"
commit="$2"
case "$mode" in health|ingest|drain) ;; *) exit 2 ;; esac
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/opt/festival-radar
release="$root/releases/$commit"
[[ "$(readlink -f "$root/current" 2>/dev/null || true)" == "$release" ]] || exit 4
[[ -f "$release/DEPLOYED_COMMIT" && "$(cat "$release/DEPLOYED_COMMIT")" == "$commit" ]] || exit 4
[[ -x "$release/.runtime/node" && -f "$release/scripts/report-db-due-health.mjs" ]] || exit 4
cd "$release"
umask 077
case "$mode" in
  health) exec "$release/.runtime/node" scripts/report-db-due-health.mjs ;;
  ingest)
    output="$(mktemp -d /opt/festival-radar/shared/.db-due.XXXXXXXX)"
    trap 'rm -rf -- "$output"' EXIT
    "$release/.runtime/node" scripts/ingest-festivals.mjs --db-due --publish --max-fetch-errors=0 "--output=$output" >/dev/null 2>&1 || { echo 'DB due ingestion failed' >&2; exit 1; } ;;
  drain)
    "$release/.runtime/node" scripts/drain-ingestion-notifications.mjs --db-due >/dev/null 2>&1 || { echo 'DB due outbox drain failed' >&2; exit 1; } ;;
esac
