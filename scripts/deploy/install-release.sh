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

[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit" >&2; exit 2; }
[[ "$app_root" == /opt/festival-radar ]] || { echo "unsupported APP_ROOT" >&2; exit 2; }
test -s "$archive"
test -s "$env_source"
install -d -m 0755 "$app_root/releases" "$shared"
install -m 0600 "$env_source" "$shared/production.env"

rm -rf "$release"
install -d -m 0755 "$release"
tar -xzf "$archive" --strip-components=1 -C "$release"
test "$(cat "$release/DEPLOYED_COMMIT")" = "$commit"

cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
set -a
# shellcheck disable=SC1090
source "$shared/production.env"
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

vhost="/var/www/vhosts/system/$domain/conf/vhost.conf"
install -d -m 0755 "$(dirname "$vhost")"
cat > "$vhost" <<APACHE
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:$port/
ProxyPassReverse / http://127.0.0.1:$port/
RequestHeader set X-Forwarded-Proto "https" env=HTTPS
APACHE

ln -sfn "$release" "$app_root/current"
chown -R www-data:www-data "$release" "$shared"
systemctl daemon-reload
systemctl enable --now "$service"
if command -v plesk >/dev/null 2>&1; then
  plesk bin httpdmng --reconfigure-domain "$domain"
else
  apache2ctl configtest
  systemctl reload apache2
fi

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
    systemctl restart "$service"
  fi
  echo "release health check failed; previous release restored" >&2
  exit 1
fi

find "$app_root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }' \
  | xargs -r rm -rf --
