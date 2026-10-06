#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
commit="${2:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
env_source="${3:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
db_due_backup=""
db_due_assets_armed=false
scheduler_assets_armed=false
scheduler_backup=""
prior_release_is_active() {
  [[ -n "$previous" && "$previous_commit" =~ ^[0-9a-f]{40}$ &&
     "$previous" == "$app_root/releases/$previous_commit" &&
     "$(readlink -f "$app_root/current" 2>/dev/null)" == "$previous" &&
     "$(cat "$previous/DEPLOYED_COMMIT" 2>/dev/null)" == "$previous_commit" ]]
}
cleanup_install() {
  local status=$? cleanup_failed=false retain_backups=false
  if [[ "$status" -ne 0 ]]; then
    # Even a failed activation command may have switched current. Restore old
    # assets only when the actual current still selects the prior stamped
    # release (or rollback really selected it). Unknown current/stamp fails closed.
    if prior_release_is_active; then
      if [[ "$scheduler_assets_armed" == true ]]; then
        scheduler_restore_assets "$scheduler_backup" || cleanup_failed=true
      fi
      if [[ "$db_due_assets_armed" == true ]]; then
        db_due_restore_assets "$db_due_unit" "$db_due_wrapper" "$db_due_backup" || cleanup_failed=true
      fi
      if [[ "$db_due_assets_armed" == true || "$scheduler_assets_armed" == true ]]; then
        systemctl daemon-reload || cleanup_failed=true
      fi
    elif [[ "$db_due_assets_armed" == true || "$scheduler_assets_armed" == true ]]; then
      # Current may have moved or lost its stamp: leave the installed assets
      # untouched, load those units into systemd, and keep snapshots for a
      # deliberate manual recovery. The DB-due timer remains quiesced.
      retain_backups=true
      systemctl daemon-reload || cleanup_failed=true
    fi
  fi
  # Keep recovery snapshots if any restore/reload failed; do not turn a failed
  # installation into success or discard its only remaining recovery evidence.
  if [[ "$cleanup_failed" == true || "$retain_backups" == true ]]; then
    if [[ "$cleanup_failed" == true ]]; then
      echo "asset cleanup failed; recovery snapshots retained: $scheduler_backup $db_due_backup" >&2
    else
      echo "active release uncertain; old assets not restored; recovery snapshots retained: $scheduler_backup $db_due_backup" >&2
    fi
    [[ "$status" -ne 0 ]] || status=1
  else
    if [[ -n "$scheduler_backup" ]]; then rm -rf -- "$scheduler_backup" || status=1; fi
    if [[ -n "$db_due_backup" ]]; then rm -rf -- "$db_due_backup" || status=1; fi
  fi
  rm -f "$archive" "$env_source" || status=1
  return "$status"
}
trap cleanup_install EXIT
app_root="${APP_ROOT:-/opt/festival-radar}"
service="${SERVICE_NAME:-festival-radar}"
domain="${APP_DOMAIN:-festivals.kir-it.de}"
port="${PORT:-3100}"
release="$app_root/releases/$commit"
shared="$app_root/shared"
previous="$(readlink -e "$app_root/current" 2>/dev/null || true)"
previous_commit="$(cat "$previous/DEPLOYED_COMMIT" 2>/dev/null || true)"
env_file="$shared/production.env"
staged_env="$shared/.production.env.$commit.tmp"
previous_env="$shared/.production.env.$commit.previous"
had_previous_env=false

[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit" >&2; exit 2; }
[[ "$app_root" == /opt/festival-radar ]] || { echo "unsupported APP_ROOT" >&2; exit 2; }
test -s "$archive"
test -s "$env_source"
install -d -m 0755 "$app_root/releases" "$shared"
install -d -o www-data -g www-data -m 0750 "$shared/ingestion"
if [[ ! -e "$shared/ingestion/source-fetch.lock" && ! -L "$shared/ingestion/source-fetch.lock" ]]; then
  install -o www-data -g www-data -m 0640 /dev/null "$shared/ingestion/source-fetch.lock"
fi
[[ -f "$shared/ingestion/source-fetch.lock" && ! -L "$shared/ingestion/source-fetch.lock" &&
   "$(stat -c %U:%a -- "$shared/ingestion/source-fetch.lock")" == www-data:640 ]] || { echo 'ingestion lock unsafe' >&2; exit 4; }
# activate-release already holds the deployment lock. Serialize release changes
# with all supported fetch paths too; no source execution occurs here.
exec 8<"$shared/ingestion/source-fetch.lock"
flock -n 8 || { echo 'source fetch already running' >&2; exit 5; }
scheduler_state=/var/lib/festival-radar-scheduler
if [[ ! -e "$scheduler_state" && ! -L "$scheduler_state" ]]; then
  install -d -o root -g root -m 0755 "$scheduler_state"
  printf 'legacy\n' > "$scheduler_state/mode"
  chmod 0644 "$scheduler_state/mode"
fi
[[ -d "$scheduler_state" && ! -L "$scheduler_state" && "$(stat -c %u:%a "$scheduler_state")" == 0:755 ]] || exit 4
scheduler_mode=off
if [[ -e "$scheduler_state/mode" || -L "$scheduler_state/mode" ]]; then
  [[ -f "$scheduler_state/mode" && ! -L "$scheduler_state/mode" &&
     "$(stat -c %u:%a "$scheduler_state/mode")" == 0:644 ]] || { echo "scheduler mode unsafe; deployment refused" >&2; exit 6; }
  scheduler_mode="$(cat "$scheduler_state/mode")"
  [[ "$scheduler_mode" == legacy || "$scheduler_mode" == db-due ]] || { echo "scheduler mode ambiguous; deployment refused" >&2; exit 6; }
fi
# Preserve an explicitly paused legacy timer across subsequent deployments.
# A Persistent calendar timer can catch up on activation; do not automatically
# rearm a disabled timer merely because the mode file still says legacy.
legacy_timer_was_armed=true
if [[ -f /etc/systemd/system/festival-radar-collection-ingestion.timer ]]; then
  legacy_enabled="$(systemctl is-enabled festival-radar-collection-ingestion.timer 2>/dev/null || true)"
  legacy_active="$(systemctl is-active festival-radar-collection-ingestion.timer 2>/dev/null || true)"
  if [[ "$legacy_enabled" == enabled && "$legacy_active" == active ]]; then
    legacy_timer_was_armed=true
  elif [[ "$legacy_enabled" == disabled && "$legacy_active" == inactive ]]; then
    legacy_timer_was_armed=false
  else
    echo "legacy timer state ambiguous; deployment refused" >&2
    exit 6
  fi
fi
# Snapshot the prior opt-in under the activation and source-fetch locks. Only
# a previously armed DB-mode timer may be restored after exact-SHA health. A
# disabled timer is an operator pause, not a request to re-enable it.
db_due_timer_was_armed=false
db_due_timer=/etc/systemd/system/festival-radar-db-due.timer
if [[ -e "$db_due_timer" || -L "$db_due_timer" ]]; then
  [[ -f "$db_due_timer" && ! -L "$db_due_timer" ]] || { echo "DB-due timer unit unsafe; deployment refused" >&2; exit 6; }
  due_enabled="$(systemctl is-enabled festival-radar-db-due.timer 2>/dev/null || true)"
  due_active="$(systemctl is-active festival-radar-db-due.timer 2>/dev/null || true)"
  if [[ "$due_enabled" == enabled && "$due_active" == active && "$scheduler_mode" == db-due ]]; then
    db_due_timer_was_armed=true
  elif [[ "$due_enabled" != disabled || "$due_active" != inactive ]]; then
    echo "DB-due timer state ambiguous; deployment refused" >&2
    exit 6
  fi
elif [[ "$scheduler_mode" == db-due ]]; then
  echo "DB-due mode without installed timer; deployment refused" >&2
  exit 6
fi
if [[ "$scheduler_mode" == db-due ]]; then
  [[ "$legacy_timer_was_armed" == false ]] || { echo "legacy timer still armed in DB mode; deployment refused" >&2; exit 6; }
  [[ "$(systemctl is-active festival-radar-collection@ingestion.service 2>/dev/null || true)" == inactive ]] || { echo "legacy ingestion not inactive; deployment refused" >&2; exit 6; }
fi
if [[ -f "$db_due_timer" ]]; then
  systemctl disable --now festival-radar-db-due.timer
  systemctl stop festival-radar-db-due-scheduler.service festival-radar-db-due@tick.service
fi
rm -f -- "$scheduler_state/last-tick"
install -m 0600 "$env_source" "$staged_env"

rm -rf "$release"
install -d -m 0755 "$release"
tar -xzf "$archive" --strip-components=1 -C "$release"
test "$(cat "$release/DEPLOYED_COMMIT")" = "$commit"
source "$release/scripts/deploy/db-due-assets.sh"
source "$release/scripts/deploy/db-due-scheduler-assets.sh"
scheduler_backup="$(mktemp -d /run/festival-radar-scheduler.XXXXXXXX)"
scheduler_snapshot_assets "$scheduler_backup"
scheduler_assets_armed=true
db_due_unit="/etc/systemd/system/$service-db-due@.service"
db_due_wrapper=/usr/local/libexec/festival-radar/start-db-due
db_due_backup="$(mktemp -d /run/festival-radar-db-due.XXXXXXXX)"
db_due_snapshot_assets "$db_due_unit" "$db_due_wrapper" "$db_due_backup"
db_due_assets_armed=true

cd "$release"
test -x "$release/.runtime/node"
test -f "$release/.runtime/npm/bin/npm-cli.js"
"$release/.runtime/node" "$release/.runtime/npm/bin/npm-cli.js" \
  ci --omit=dev --ignore-scripts --no-audit --no-fund
set -a
# shellcheck disable=SC1090
source "$staged_env"
set +a
export DEPLOYED_COMMIT="$commit" PORT="$port" HOSTNAME=127.0.0.1
"$release/.runtime/node" node_modules/prisma/build/index.js generate
"$release/.runtime/node" node_modules/prisma/build/index.js migrate deploy

source "$release/scripts/deploy/playlist-timer-install.sh"
playlist_install_select_mode
playlist_install_quiesce_other

cat > "/etc/systemd/system/$service.service" <<UNIT
[Unit]
Description=Festival Radar Next.js application
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$app_root/current
EnvironmentFile=$shared/production.env
Environment=NODE_ENV=production
Environment=PORT=$port
Environment=HOSTNAME=127.0.0.1
ExecStart=$app_root/current/.runtime/node server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$app_root

[Install]
WantedBy=multi-user.target
UNIT

# Manual-only, operator-triggered, fixed-mode DB due operation. The application
# user still owns the release and database credentials: this is NOT a DB access
# security boundary. No timer or enablement.
cat > "$db_due_unit" <<UNIT
[Unit]
Description=Manual Festival Radar DB due operation %i
After=postgresql.service

[Service]
Type=oneshot
User=www-data
Group=www-data
WorkingDirectory=$release
EnvironmentFile=$shared/production.env
Environment=NODE_ENV=production
ExecStart=$release/scripts/deploy/run-db-due-operation.sh %i $commit
StandardOutput=append:/run/festival-radar-db-due/%i.audit
StandardError=null
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$shared
TimeoutStartSec=7500
UNIT
install -o root -g root -m 0755 "$release/scripts/deploy/start-db-due" "$db_due_wrapper"

install -o root -g root -m 0755 "$release/scripts/deploy/db-due-scheduler" /usr/local/libexec/festival-radar/db-due-scheduler
install -o root -g root -m 0755 "$release/scripts/deploy/check-db-due-tick-ready" /usr/local/libexec/festival-radar/check-db-due-tick-ready
cat > "/etc/systemd/system/$service-db-due-scheduler.service" <<UNIT
[Unit]
Description=Serialized bounded Festival Radar DB due tick
After=postgresql.service
[Service]
Type=oneshot
User=root
# OnBootSec may already have elapsed when the timer is re-enabled under the
# activation lock. A classified lock deferral skips just this tick without
# marking the unit failed; the next OnUnitInactiveSec tick still runs normally.
ExecCondition=/usr/local/libexec/festival-radar/check-db-due-tick-ready
ExecStart=/usr/local/libexec/festival-radar/db-due-scheduler $commit tick
TimeoutStartSec=1300
StandardError=null
UNIT
cat > "/etc/systemd/system/$service-db-due.timer" <<UNIT
[Unit]
Description=Opt-in Festival Radar DB due schedule
[Timer]
OnBootSec=10min
OnUnitInactiveSec=10min
AccuracySec=15s
Unit=$service-db-due-scheduler.service
[Install]
WantedBy=timers.target
UNIT
# Intentionally no enable/start for the new timer or service.

cat > "/etc/systemd/system/$service-collection@.service" <<UNIT
[Unit]
Description=Festival Radar production collection job %i
After=network-online.target $service.service
Requires=$service.service
[Service]
Type=oneshot
User=www-data
Group=www-data
WorkingDirectory=$app_root/current
EnvironmentFile=$shared/production.env
Environment=NODE_ENV=production
Environment=APP_ROOT=$app_root
Environment=PLAYLIST_PYTHON=python3
Environment=PYTHONPATH=$app_root/current/.python
Environment=COLLECTION_APP_URL=http://127.0.0.1:$port
ExecStart=$app_root/current/scripts/deploy/run-collection-job.sh %i
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$shared
TimeoutStartSec=2700
UNIT

install_collection_timer() {
  local job="$1" calendar="$2"
  cat > "/etc/systemd/system/$service-collection-$job.timer" <<UNIT
[Unit]
Description=Schedule Festival Radar collection job $job
[Timer]
OnCalendar=$calendar
Persistent=true
RandomizedDelaySec=300
Unit=$service-collection@$job.service
[Install]
WantedBy=timers.target
UNIT
}
install_collection_timer artist-identities '*-*-* *:17:00 UTC'
install_collection_timer ingestion '*-*-* 03:23:00 UTC'
install_collection_timer playlists 'Tue,Fri *-*-* 04:17:00 UTC'
# A new installation stays dormant; validated durable cutover preserves DB mode.
install_collection_timer playlists-db '*-*-* *:00/10:00 UTC'
install_collection_timer source-monitor '*-*-01,04,07,10,13,16,19,22,25,28 04:17:00 UTC'

cat > "/etc/systemd/system/$service-notifications.service" <<UNIT
[Unit]
Description=Festival Radar notification dispatcher
After=$service.service
Requires=$service.service

[Service]
Type=oneshot
User=www-data
Group=www-data
EnvironmentFile=$shared/production.env
Environment=NODE_BINARY=$release/.runtime/node
ExecStart=$release/scripts/notifications/dispatch-production.sh
RuntimeDirectory=festival-radar-notifications
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$shared /run/festival-radar-notifications
UNIT

cat > "/etc/systemd/system/$service-notifications.timer" <<UNIT
[Unit]
Description=Dispatch Festival Radar notifications every ten minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=10min
AccuracySec=15s
Persistent=true
Unit=$service-notifications.service

[Install]
WantedBy=timers.target
UNIT

cat > "/etc/systemd/system/$service-analytics-retention.service" <<UNIT
[Unit]
Description=Festival Radar privacy analytics retention
After=$service.service
Requires=$service.service

[Service]
Type=oneshot
User=www-data
Group=www-data
EnvironmentFile=$shared/production.env
Environment=NODE_BINARY=$release/.runtime/node
Environment=ANALYTICS_RETENTION_APP_URL=http://127.0.0.1:$port
ExecStart=$release/scripts/analytics/prune-production.sh
RuntimeDirectory=festival-radar-analytics
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$shared /run/festival-radar-analytics
UNIT

cat > "/etc/systemd/system/$service-analytics-retention.timer" <<UNIT
[Unit]
Description=Prune Festival Radar privacy analytics daily

[Timer]
OnCalendar=*-*-* 03:17:00 UTC
RandomizedDelaySec=2min
Persistent=true
Unit=$service-analytics-retention.service

[Install]
WantedBy=timers.target
UNIT

vhost_directory="/var/www/vhosts/system/$domain/conf"
install -d -m 0755 "$vhost_directory"
for vhost in "$vhost_directory/vhost.conf" "$vhost_directory/vhost_ssl.conf"; do
cat > "$vhost" <<APACHE
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:$port/
ProxyPassReverse / http://127.0.0.1:$port/
RequestHeader set X-Forwarded-Proto "https" env=HTTPS
<IfModule mod_security2.c>
  # The OWASP CRS treats the word "logout" in this POST target as an attack
  # before the request reaches Next.js. Keep the exception scoped to the one
  # session-destruction endpoint; the application still enforces same-origin.
  <LocationMatch "^/api/auth/logout/?$">
    SecRuleEngine Off
  </LocationMatch>
</IfModule>
APACHE
done

# Privacy analytics bypasses both nginx and Apache access logs. The exact
# locations proxy directly to the loopback application and deliberately omit
# client-address forwarding; query strings do not participate in nginx
# location matching, so both endpoint spellings remain covered.
nginx_vhost="/var/www/vhosts/system/$domain/conf/vhost_nginx.conf"
cat > "$nginx_vhost" <<NGINX
location = /api/analytics/page-view {
    access_log off;
    proxy_pass http://127.0.0.1:$port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Real-IP "";
    proxy_set_header X-Forwarded-For "";
}

location = /api/analytics/page-view/ {
    access_log off;
    proxy_pass http://127.0.0.1:$port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Real-IP "";
    proxy_set_header X-Forwarded-For "";
}
NGINX
chmod 0644 "$nginx_vhost"

if [[ -f "$env_file" ]]; then
  cp -p "$env_file" "$previous_env"
  had_previous_env=true
fi
mv -f "$staged_env" "$env_file"
ln -sfn "$release" "$app_root/current"
chown -R www-data:www-data "$release" "$shared"
systemctl daemon-reload
systemctl enable "$service"
for collection_job in artist-identities source-monitor; do
  systemctl enable --now "$service-collection-$collection_job.timer"
done
if [[ "$scheduler_mode" == legacy && "$legacy_timer_was_armed" == true ]]; then
  systemctl enable --now "$service-collection-ingestion.timer"
elif [[ "$scheduler_mode" == legacy ]]; then
  # Preserve the failed oneshot for the separate reviewed recovery operation.
  systemctl disable --now "$service-collection-ingestion.timer"
else
  systemctl disable --now "$service-collection-ingestion.timer"
  systemctl stop "$service-collection@ingestion.service"
fi
systemctl restart "$service"
systemctl enable --now "$service-notifications.timer"
systemctl enable --now "$service-analytics-retention.timer"
bash "$release/scripts/deploy/reconfigure-webserver.sh" "$domain"

healthy=false
for _ in $(seq 1 20); do
  if response="$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$port/api/health/deployment/")" \
    && grep -Fq "\"commit\":\"$commit\"" <<<"$response" \
    && grep -Fq '"database":"ok"' <<<"$response" \
    && grep -Fq '"catalog":"database"' <<<"$response"; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  if [[ -n "$previous" && -d "$previous" && "$previous_commit" =~ ^[0-9a-f]{40}$ &&
        "$previous" == "$app_root/releases/$previous_commit" &&
        "$(cat "$previous/DEPLOYED_COMMIT" 2>/dev/null)" == "$previous_commit" ]]; then
    ln -sfn "$previous" "$app_root/current"
  fi
  prior_release_is_active || { echo "release health check failed; prior stamped release not restored; active assets retained" >&2; exit 1; }
  scheduler_restore_assets "$scheduler_backup"
  scheduler_assets_armed=false
  db_due_restore_assets "$db_due_unit" "$db_due_wrapper" "$db_due_backup"
  systemctl daemon-reload
  db_due_assets_armed=false
  if [[ "$had_previous_env" == true ]]; then
    mv -f "$previous_env" "$env_file"
  else
    rm -f "$env_file"
  fi
  if [[ -n "$previous" && -d "$previous" ]]; then
    systemctl restart "$service"
  fi
  echo "release health check failed; previous release restored" >&2
  exit 1
fi

# Rearm only after successful release health; a rollback or a paused DB-due
# timer never gets here with an armed snapshot. Keep both shared locks held.
playlist_install_apply_mode
if [[ "$db_due_timer_was_armed" == true ]]; then
  # Recheck durable mode, exact release and HTTP closure immediately before
  # rearming. Refuse uncertain systemd states rather than risking two fetchers.
  [[ -f "$scheduler_state/mode" && ! -L "$scheduler_state/mode" &&
     "$(stat -c %u:%a "$scheduler_state/mode")" == 0:644 &&
     "$(cat "$scheduler_state/mode")" == db-due &&
     "$(readlink -f "$app_root/current")" == "$release" &&
     "$(cat "$release/DEPLOYED_COMMIT")" == "$commit" &&
     "$(systemctl is-enabled "$service-collection-ingestion.timer" 2>/dev/null || true)" == disabled &&
     "$(systemctl is-active "$service-collection-ingestion.timer" 2>/dev/null || true)" == inactive &&
     "$(systemctl is-active "$service-collection@ingestion.service" 2>/dev/null || true)" == inactive &&
     "$(systemctl is-enabled "$service-db-due.timer" 2>/dev/null || true)" == disabled &&
     "$(systemctl is-active "$service-db-due.timer" 2>/dev/null || true)" == inactive &&
     "$(systemctl is-active "$service-db-due-scheduler.service" 2>/dev/null || true)" == inactive &&
     "$(systemctl is-active "$service-db-due@tick.service" 2>/dev/null || true)" == inactive ]] || { echo "DB-due rearm state ambiguous; deployment refused" >&2; exit 6; }
  due_health="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$port/api/health/deployment/")" || { echo "DB-due deployment health unavailable; deployment refused" >&2; exit 6; }
  if [[ ${#due_health} -gt 2048 ]] || ! "$release/.runtime/node" -e 'const h=JSON.parse(process.argv[1]); if (h.status!=="ok" || h.database!=="ok" || h.catalog!=="database" || h.commit!==process.argv[2]) process.exit(1)' "$due_health" "$commit" >/dev/null 2>&1; then
    echo "DB-due exact-SHA health failed; deployment refused" >&2
    exit 6
  fi
  due_probe="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$port/api/ingestion/run/")" || { echo "DB-due closure probe unavailable; deployment refused" >&2; exit 6; }
  [[ "$due_probe" == "{\"legacyRouteInactive\":true,\"commit\":\"$commit\"}" ]] || { echo "DB-due exact-SHA closure probe failed; deployment refused" >&2; exit 6; }
  # If systemctl partially arms the timer, inhibit it before returning failure.
  if ! systemctl enable --now "$service-db-due.timer" ||
     [[ "$(systemctl is-enabled "$service-db-due.timer" 2>/dev/null || true)" != enabled ]] ||
     [[ "$(systemctl is-active "$service-db-due.timer" 2>/dev/null || true)" != active ]]; then
    systemctl disable --now "$service-db-due.timer" || true
    echo "DB-due timer rearm failed; deployment refused" >&2
    exit 6
  fi
fi

db_due_assets_armed=false
scheduler_assets_armed=false
rm -f "$previous_env"

find "$app_root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }' \
  | xargs -r rm -rf --
