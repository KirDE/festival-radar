#!/usr/bin/env bash
set -euo pipefail

domain="${1:?usage: reconfigure-webserver.sh DOMAIN}"
plesk_httpdmng="${PLESK_HTTPDMNG:-/usr/local/psa/admin/sbin/httpdmng}"

if [[ -x "$plesk_httpdmng" ]]; then
  "$plesk_httpdmng" --reconfigure-domain "$domain"
else
  apache2ctl configtest
  systemctl reload apache2
fi
