#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
commit="${2:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
env_source="${3:?usage: install-release.sh ARCHIVE COMMIT ENV_FILE}"
trap 'rm -f "$archive" "$env_source"' EXIT
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
install -m 0600 "$env_source" "$staged_env"

rm -rf "$release"
install -d -m 0755 "$release"
tar -xzf "$archive" --strip-components=1 -C "$release"
test "$(cat "$release/DEPLOYED_COMMIT")" = "$commit"

cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
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

vhost="/var/www/vhosts/system/$domain/conf/vhost.conf"
install -d -m 0755 "$(dirname "$vhost")"
cat > "$vhost" <<APACHE
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:$port/
ProxyPassReverse / http://127.0.0.1:$port/
RequestHeader set X-Forwarded-Proto "https" env=HTTPS
APACHE

if [[ -f "$env_file" ]]; then
  cp -p "$env_file" "$previous_env"
  had_previous_env=true
fi
mv -f "$staged_env" "$env_file"
ln -sfn "$release" "$app_root/current"
chown -R www-data:www-data "$release" "$shared"
systemctl daemon-reload
systemctl enable "$service"
systemctl restart "$service"
systemctl enable --now "$service-notifications.timer"
systemctl enable --now "$service-analytics-retention.timer"
bash "$release/scripts/deploy/reconfigure-webserver.sh" "$domain"

healthy=false
for _ in $(seq 1 20); do
  if response="$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$port/api/health/deployment/")" \
    && grep -Fq "\"commit\":\"$commit\"" <<<"$response" \
    && grep -Fq '"database":"ok"' <<<"$response"; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$app_root/current"
  fi
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

rm -f "$previous_env"

find "$app_root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }' \
  | xargs -r rm -rf --
