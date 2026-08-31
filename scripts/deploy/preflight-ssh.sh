#!/usr/bin/env bash
set -euo pipefail

target="${1:-production}"

if ! ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  -o ConnectionAttempts=1 \
  "$target" true >/dev/null 2>&1; then
  echo "Deployment SSH preflight failed: authentication or remote command access is unavailable for '$target'. Verify the production deploy key, host, port, and known-hosts secret; then retry the workflow." >&2
  exit 1
fi

echo "Deployment SSH preflight passed for '$target'."
