#!/usr/bin/env bash
set -euo pipefail

state_file="${ANALYTICS_RETENTION_STATE_FILE:-/opt/festival-radar/shared/analytics-retention-state.json}"
lock_file="${ANALYTICS_RETENTION_LOCK_FILE:-/run/festival-radar-analytics/prune.lock}"
app_url="${ANALYTICS_RETENTION_APP_URL:-http://127.0.0.1:3100}"

test -n "${ANALYTICS_RETENTION_TOKEN:-}" || { echo "ANALYTICS_RETENTION_TOKEN is required" >&2; exit 2; }
test -n "${NODE_BINARY:-}" || { echo "NODE_BINARY is required" >&2; exit 2; }
exec 9>"$lock_file"
flock -n 9 || { echo "analytics retention already running"; exit 0; }

started_at="$(date -u +%FT%TZ)"
response_file="$(mktemp)"
state_tmp="$(mktemp "$(dirname "$state_file")/.analytics-retention-state.XXXXXX")"
trap 'rm -f "$response_file" "$state_tmp"' EXIT

http_status=""
if http_status="$(curl --silent --show-error --max-time 240 \
  -X POST \
  -H "authorization: Bearer $ANALYTICS_RETENTION_TOKEN" \
  --output "$response_file" \
  --write-out '%{http_code}' \
  "${app_url%/}/api/analytics/prune/")" && [[ "$http_status" == 2?? ]]; then
  finished_at="$(date -u +%FT%TZ)"
  if "$NODE_BINARY" - "$response_file" "$started_at" "$finished_at" >"$state_tmp" <<'NODE'
const [file, startedAt, finishedAt] = process.argv.slice(2);
const result = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
if (!Number.isInteger(result.deletedAggregateRows) || result.deletedAggregateRows < 0
    || !Number.isInteger(result.retentionDays) || result.retentionDays < 1 || result.retentionDays > 730
    || Number.isNaN(Date.parse(result.cutoff))) {
  throw new Error("invalid analytics retention response");
}
process.stdout.write(JSON.stringify({
  startedAt,
  finishedAt,
  ok: true,
  deletedAggregateRows: result.deletedAggregateRows,
  cutoff: result.cutoff,
  retentionDays: result.retentionDays,
}) + "\n");
NODE
  then
    chmod 0640 "$state_tmp"
    mv -f "$state_tmp" "$state_file"
    cat "$state_file"
  else
    printf 'analytics retention returned an invalid response\n' >&2
    printf '{"startedAt":"%s","finishedAt":"%s","ok":false}\n' "$started_at" "$finished_at" >"$state_tmp"
    chmod 0640 "$state_tmp"
    mv -f "$state_tmp" "$state_file"
    exit 1
  fi
else
  finished_at="$(date -u +%FT%TZ)"
  if [[ -n "$http_status" && "$http_status" != "000" ]]; then
    printf 'analytics retention failed with HTTP %s\n' "$http_status" >&2
  else
    printf 'analytics retention request failed before an HTTP response\n' >&2
  fi
  printf '{"startedAt":"%s","finishedAt":"%s","ok":false}\n' "$started_at" "$finished_at" >"$state_tmp"
  chmod 0640 "$state_tmp"
  mv -f "$state_tmp" "$state_file"
  exit 1
fi
