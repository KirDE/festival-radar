#!/usr/bin/env bash
set -euo pipefail

public_key="${1:?usage: bootstrap-deploy-user.sh PUBLIC_KEY_FILE}"
deploy_user="festival-radar-deploy"
home="/var/lib/festival-radar-deploy"

test "$(id -u)" = 0
test -s "$public_key"
id "$deploy_user" >/dev/null 2>&1 || useradd --system --home-dir "$home" --create-home --shell /bin/bash "$deploy_user"
install -d -o "$deploy_user" -g "$deploy_user" -m 0700 "$home/.ssh"
install -d -o "$deploy_user" -g "$deploy_user" -m 0700 "$home/incoming"
install -o "$deploy_user" -g "$deploy_user" -m 0600 "$public_key" "$home/.ssh/authorized_keys"
install -d -o root -g root -m 0755 /usr/local/libexec/festival-radar
install -o root -g root -m 0755 scripts/deploy/install-release.sh /usr/local/libexec/festival-radar/install-release.sh
install -o root -g root -m 0755 scripts/deploy/activate-release /usr/local/libexec/festival-radar/activate-release
install -o root -g root -m 0755 scripts/deploy/upgrade-deployment-assets /usr/local/libexec/festival-radar/upgrade-deployment-assets
printf '%s\n' \
  'festival-radar-deploy ALL=(root) NOPASSWD: /usr/local/libexec/festival-radar/activate-release [0-9a-f]*' \
  'festival-radar-deploy ALL=(root) NOPASSWD: /usr/local/libexec/festival-radar/upgrade-deployment-assets [0-9a-f]*' \
  > /etc/sudoers.d/festival-radar-deploy
chmod 0440 /etc/sudoers.d/festival-radar-deploy
visudo -cf /etc/sudoers.d/festival-radar-deploy
