#!/usr/bin/env bash
# Sourced by install-release after migrations, with the staged environment.
playlist_timers_inhibit() {
  local failed=false
  # Attempt both even if one systemctl operation fails. Never stop collection
  # services here: a provider write may already be in flight under refresh.lock.
  systemctl disable --now "$service-collection-playlists.timer" || failed=true
  systemctl disable --now "$service-collection-playlists-db.timer" || failed=true
  if [[ "$failed" == true ]]; then
    echo 'playlist timer inhibition incomplete; systemctl recovery required' >&2
  fi
  return 0
}

playlist_install_select_mode() {
  local proof legacy_enabled legacy_active db_enabled db_active
  playlist_install_mode=off
  if ! proof="$(timeout 30 "$release/.runtime/node" --experimental-strip-types "$release/scripts/deploy/read-playlist-install-mode.ts" 2>/dev/null)"; then
    playlist_timers_inhibit
    echo 'playlist cutover proof unavailable or invalid; deployment refused' >&2
    return 6
  fi
  case "$proof" in
    database) playlist_install_mode=database ;;
    absent)
      # A DB timer left armed, or both timers paused, could be a lost cutover
      # receipt. Only a positively armed legacy path (or a fresh installation)
      # with a dormant/missing DB timer establishes pre-cutover scheduling.
      legacy_enabled="$(systemctl is-enabled "$service-collection-playlists.timer" 2>/dev/null || true)"
      legacy_active="$(systemctl is-active "$service-collection-playlists.timer" 2>/dev/null || true)"
      db_enabled="$(systemctl is-enabled "$service-collection-playlists-db.timer" 2>/dev/null || true)"
      db_active="$(systemctl is-active "$service-collection-playlists-db.timer" 2>/dev/null || true)"
      if [[ "$db_active" == inactive && "$legacy_active" == active && "$legacy_enabled" == enabled &&
            ( "$db_enabled" == disabled || "$db_enabled" == not-found ) ||
            "$legacy_enabled" == not-found && "$legacy_active" == inactive &&
            "$db_enabled" == not-found && "$db_active" == inactive ]]; then
        playlist_install_mode=legacy
      else
        playlist_timers_inhibit
        echo 'playlist cutover proof absent with ambiguous timer state; deployment refused' >&2
        return 6
      fi ;;
    *)
      playlist_timers_inhibit
      echo 'playlist cutover proof ambiguous; deployment refused' >&2
      return 6 ;;
  esac
}

playlist_install_quiesce_other() {
  local rejected enabled active
  case "$playlist_install_mode" in
    database) rejected=playlists ;;
    legacy) rejected=playlists-db ;;
    *) playlist_timers_inhibit; return 6 ;;
  esac
  enabled="$(systemctl is-enabled "$service-collection-$rejected.timer" 2>/dev/null || true)"
  if [[ "$enabled" == not-found ]]; then
    active="$(systemctl is-active "$service-collection-$rejected.timer" 2>/dev/null || true)"
    if [[ "$active" == inactive ]]; then return 0; fi
    playlist_timers_inhibit
    echo 'playlist timer unit missing but not inactive; deployment refused' >&2
    return 6
  fi
  if ! systemctl disable --now "$service-collection-$rejected.timer"; then
    playlist_timers_inhibit
    echo 'playlist timer inhibition failed; deployment refused' >&2
    return 6
  fi
}

playlist_install_apply_mode() {
  local selected rejected expected proof
  case "$playlist_install_mode" in
    database) selected=playlists-db; rejected=playlists; expected=database ;;
    legacy) selected=playlists; rejected=playlists-db; expected=absent ;;
    *) playlist_timers_inhibit; return 6 ;;
  esac
  # Migration and health checks take time. A cutover may have changed during
  # deployment; never rearm a timer based solely on the earlier snapshot.
  if ! proof="$(timeout 30 "$release/.runtime/node" --experimental-strip-types "$release/scripts/deploy/read-playlist-install-mode.ts" 2>/dev/null)" ||
     [[ "$proof" != "$expected" ]]; then
    playlist_timers_inhibit
    echo 'playlist cutover proof changed or unavailable; deployment refused' >&2
    return 6
  fi
  # Disable the other timer first, including repair of the dual-timer incident.
  if ! systemctl disable --now "$service-collection-$rejected.timer" ||
     ! systemctl enable --now "$service-collection-$selected.timer"; then
    playlist_timers_inhibit
    echo 'playlist timer installation failed; inhibition attempted for both timers' >&2
    return 6
  fi
}
