#!/usr/bin/env bash
# Scheduler assets are restored on failed install; restored timers remain OFF.
scheduler_assets=(/etc/systemd/system/festival-radar-db-due.timer /etc/systemd/system/festival-radar-db-due-scheduler.service /usr/local/libexec/festival-radar/db-due-scheduler)
scheduler_snapshot_assets() {
  local backup="$1" index
  for index in "${!scheduler_assets[@]}"; do
    if [[ -e "${scheduler_assets[$index]}" || -L "${scheduler_assets[$index]}" ]]; then
      cp -a -- "${scheduler_assets[$index]}" "$backup/$index"
    fi
  done
}
scheduler_restore_assets() {
  local backup="$1" index
  systemctl disable --now festival-radar-db-due.timer >/dev/null 2>&1 || true
  systemctl stop festival-radar-db-due-scheduler.service festival-radar-db-due@tick.service >/dev/null 2>&1 || true
  for index in "${!scheduler_assets[@]}"; do
    if [[ -e "$backup/$index" || -L "$backup/$index" ]]; then
      cp -a -- "$backup/$index" "${scheduler_assets[$index]}"
    else
      rm -f -- "${scheduler_assets[$index]}"
    fi
  done
}
