#!/usr/bin/env bash
set -euo pipefail

state_file="${NOTIFICATION_SCHEDULER_STATE_FILE:-/opt/festival-radar/shared/notification-scheduler-state.json}"
lock_file="${NOTIFICATION_SCHEDULER_LOCK_FILE:-/run/festival-radar-notifications/dispatch.lock}"
app_url="${APP_URL:-http://127.0.0.1:3100}"

test -n "${INTERNAL_API_SECRET:-}" || { echo "INTERNAL_API_SECRET is required" >&2; exit 2; }
exec 9>"$lock_file"
flock -n 9 || { echo "notification dispatch already running"; exit 0; }

started_at="$(date -u +%FT%TZ)"
response_file="$(mktemp)"
state_tmp="$(mktemp "$(dirname "$state_file")/.notification-scheduler-state.XXXXXX")"
trap 'rm -f "$response_file" "$state_tmp"' EXIT

if curl --fail-with-body --silent --show-error --max-time 240 \
  -H "authorization: Bearer $INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  --data '{"limit":500}' \
  "${app_url%/}/api/notifications/dispatch/" >"$response_file"; then
  finished_at="$(date -u +%FT%TZ)"
  "$NODE_BINARY" - "$response_file" "$started_at" "$finished_at" >"$state_tmp" <<'NODE'
const [file, startedAt, finishedAt] = process.argv.slice(2);
const result = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
const statuses = (result.results || []).reduce((out, item) => {
  out[item.status] = (out[item.status] || 0) + 1;
  return out;
}, {});
process.stdout.write(JSON.stringify({ startedAt, finishedAt, ok: true, processed: result.processed, statuses }) + "\n");
NODE
  chmod 0640 "$state_tmp"
  mv -f "$state_tmp" "$state_file"
  cat "$state_file"
else
  finished_at="$(date -u +%FT%TZ)"
  printf '{"startedAt":"%s","finishedAt":"%s","ok":false}\n' "$started_at" "$finished_at" >"$state_tmp"
  chmod 0640 "$state_tmp"
  mv -f "$state_tmp" "$state_file"
  exit 1
fi
