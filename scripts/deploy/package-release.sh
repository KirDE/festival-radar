#!/usr/bin/env bash
set -euo pipefail

commit="${1:?usage: package-release.sh COMMIT [OUTPUT]}"
output="${2:-festival-radar-${commit}.tar.gz}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

test -f .next/standalone/server.js
mkdir -p "$stage/app/.next" "$stage/app/.runtime"
cp "$(command -v node)" "$stage/app/.runtime/node"
chmod 0755 "$stage/app/.runtime/node"
cp -a .next/standalone/. "$stage/app/"
cp -a .next/static "$stage/app/.next/static"
cp -a public "$stage/app/public"
cp package.json package-lock.json "$stage/app/"
cp -a prisma "$stage/app/prisma"
printf '%s\n' "$commit" > "$stage/app/DEPLOYED_COMMIT"
tar -C "$stage" -czf "$output" app
tar -tzf "$output" >/dev/null
