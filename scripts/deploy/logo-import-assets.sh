#!/usr/bin/env bash
# Sourced by install-release.sh. Only the manual logo unit belongs to this
# snapshot; the root-owned dispatcher is upgraded separately before install.
logo_import_snapshot_unit() {
  local unit="$1" backup="$2"
  if [[ -e "$unit" || -L "$unit" ]]; then
    [[ -f "$unit" && ! -L "$unit" ]] || { echo 'logo unit unsafe' >&2; return 1; }
    cp -p -- "$unit" "$backup/unit"
  fi
}

logo_import_restore_unit() {
  local unit="$1" backup="$2"
  # Never follow a unit symlink created while installing. On failure, a missing
  # manual unit is safer than pointing an old release at an invalid runner.
  rm -f -- "$unit"
  if [[ -f "$backup/unit" && ! -L "$backup/unit" ]]; then
    cp -p -- "$backup/unit" "$unit"
  fi
}
