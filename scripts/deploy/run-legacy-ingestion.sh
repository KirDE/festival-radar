#!/usr/bin/env bash
set -euo pipefail
# Called INSIDE the HTTP route's source-fetch flock. Missing/invalid mode fails closed.
mode=/var/lib/festival-radar-scheduler/mode
[[ -f "$mode" && ! -L "$mode" && "$(stat -c %u:%a "$mode")" == 0:644 && "$(cat "$mode")" == legacy ]] || exit 73
exec "$@"
