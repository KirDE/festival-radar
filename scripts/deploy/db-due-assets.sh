#!/usr/bin/env bash
# Sourced by the installer. Snapshot the two manual DB-due assets so a failed
# health gate does not leave a new pinned unit or wrapper behind.
db_due_snapshot_assets() {
  local unit="$1" wrapper="$2" backup="$3"
  for asset in unit wrapper; do
    local path
    if [[ "$asset" == unit ]]; then path="$unit"; else path="$wrapper"; fi
    if [[ -e "$path" || -L "$path" ]]; then
      cp -a -- "$path" "$backup/$asset"
    fi
  done
}

db_due_restore_assets() {
  local unit="$1" wrapper="$2" backup="$3"
  for asset in unit wrapper; do
    local path
    if [[ "$asset" == unit ]]; then path="$unit"; else path="$wrapper"; fi
    if [[ -e "$backup/$asset" || -L "$backup/$asset" ]]; then
      cp -a -- "$backup/$asset" "$path"
    else
      rm -f -- "$path"
    fi
  done
}
