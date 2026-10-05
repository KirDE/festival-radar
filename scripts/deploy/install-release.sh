#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
commit="${2:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
env_source="${3:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
db_due_backup=""
db_due_assets_armed=false
scheduler_assets_armed=false
scheduler_backup=""
logo_import_backup=""
logo_import_unit_armed=false
cleanup_install() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    if [[ "$scheduler_assets_armed" == true ]]; then
      scheduler_restore_assets "$scheduler_backup"
    fi
    if [[ "$logo_import_unit_armed" == true ]]; then
      logo_import_restore_unit "$logo_import_unit" "$logo_import_backup"
    fi
    if [[ "$db_due_assets_armed" == true ]]; then
      db_due_restore_assets "$db_due_unit" "$db_due_wrapper" "$db_due_backup"
    fi
    if [[ "$logo_import_unit_armed" == true || "$db_due_assets_armed" == true || "$scheduler_assets_armed" == true ]]; then
      systemctl daemon-reload
    fi
  fi
  if [[ -n "$scheduler_backup" ]]; then rm -rf -- "$scheduler_backup"; fi
  rm -f "$archive" "$env_source"
  if [[ -n "$db_due_backup" ]]; then rm -rf -- "$db_due_backup"; fi
  if [[ -n "$logo_import_backup" ]]; then rm -rf -- "$logo_import_backup"; fi
}
trap cleanup_install EXIT
app_root="${APP_ROOT:-/opt/festival-radar}"
service="${SERVICE_NAME:-festival-radar}"
domain="${APP_DOMAIN:-festivals.kir-it.de}"
port="${PORT:-3100}"
release="$app_root/releases/$commit"
shared="$app_root/shared"
previous="$(readlink -f "$app_root/current" 2>/dev/null || true)"
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
if [[ -f "$scheduler_state/mode" && ! -L "$scheduler_state/mode" && "$(stat -c %u:%a "$scheduler_state/mode")" == 0:644 ]]; then
  scheduler_mode="$(cat "$scheduler_state/mode")"
fi
# Installation never activates a new due timer, including on later deployments.
# Existing DB-due mode requires an explicit exact-SHA re-arm after health gates.
if [[ -f /etc/systemd/system/festival-radar-db-due.timer ]]; then
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
source "$release/scripts/deploy/logo-import-assets.sh"
db_due_unit="/etc/systemd/system/$service-db-due@.service"
db_due_wrapper=/usr/local/libexec/festival-radar/start-db-due
db_due_backup="$(mktemp -d /run/festival-radar-db-due.XXXXXXXX)"
db_due_snapshot_assets "$db_due_unit" "$db_due_wrapper" "$db_due_backup"
db_due_assets_armed=true
logo_import_unit="/etc/systemd/system/$service-logo-import@.service"
logo_import_backup="$(mktemp -d /run/festival-radar-logo-import.XXXXXXXX)"
logo_import_snapshot_unit "$logo_import_unit" "$logo_import_backup"
logo_import_unit_armed=true

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

# Manual-only unit: never enable or schedule it. A privileged fixed-mode wrapper
# controls invocation; the database operation itself runs as the application user.
cat > "/etc/systemd/system/$service-source-backfill@.service" <<UNIT
[Unit]
Description=Manual Festival Radar source configuration operation %i
After=postgresql.service

[Service]
Type=oneshot
User=www-data
Group=www-data
WorkingDirectory=$app_root/current
EnvironmentFile=$shared/production.env
EnvironmentFile=/run/festival-radar-source-backfill/%i.env
Environment=NODE_ENV=production
ExecStart=$app_root/current/.runtime/node --experimental-strip-types $app_root/current/scripts/deploy/run-source-backfill.ts %i
StandardOutput=append:/run/festival-radar-source-backfill/%i.audit
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
TimeoutStartSec=120
UNIT

# Manual-only fixed-mode logo operation. Apply requires separate explicit dispatch. Never enable or schedule.
# PID 1 opens the root-owned audit before dropping privileges to www-data.
cat > "/etc/systemd/system/$service-logo-import@.service" <<UNIT
[Unit]
Description=Manual Festival Radar reviewed logo audit %i
After=postgresql.service

[Service]
Type=oneshot
User=www-data
Group=www-data
WorkingDirectory=$app_root/current
EnvironmentFile=$shared/production.env
EnvironmentFile=/run/festival-radar-logo-import/%i.env
Environment=NODE_ENV=production
ExecStart=$app_root/current/.runtime/node --experimental-strip-types $app_root/current/scripts/deploy/run-reviewed-logo-import.ts %i
StandardOutput=append:/run/festival-radar-logo-import/%i.audit
StandardError=null
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
TimeoutStartSec=120
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
cat > "/etc/systemd/system/$service-db-due-scheduler.service" <<UNIT
[Unit]
Description=Serialized bounded Festival Radar DB due tick
After=postgresql.service
[Service]
Type=oneshot
User=root
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
for collection_job in artist-identities playlists source-monitor; do
  systemctl enable --now "$service-collection-$collection_job.timer"
done
if [[ "$scheduler_mode" == legacy ]]; then
  systemctl enable --now "$service-collection-ingestion.timer"
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
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$app_root/current"
  fi
  scheduler_restore_assets "$scheduler_backup"
  scheduler_assets_armed=false
  logo_import_restore_unit "$logo_import_unit" "$logo_import_backup"
  db_due_restore_assets "$db_due_unit" "$db_due_wrapper" "$db_due_backup"
  systemctl daemon-reload
  logo_import_unit_armed=false
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

logo_import_unit_armed=false
db_due_assets_armed=false
scheduler_assets_armed=false
rm -f "$previous_env"

find "$app_root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }' \
  | xargs -r rm -rf --
