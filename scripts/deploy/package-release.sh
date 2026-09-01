#!/usr/bin/env bash
set -euo pipefail

commit="${1:?usage: package-release.sh COMMIT [OUTPUT]}"
output="${2:-festival-radar-${commit}.tar.gz}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

test -f .next/standalone/server.js
mkdir -p "$stage/app/.next" "$stage/app/.runtime" "$stage/app/scripts/deploy"
cp "$(command -v node)" "$stage/app/.runtime/node"
chmod 0755 "$stage/app/.runtime/node"
npm_cli="$(readlink -f "$(command -v npm)")"
npm_root="$(dirname "$(dirname "$npm_cli")")"
test -f "$npm_root/bin/npm-cli.js"
cp -a "$npm_root" "$stage/app/.runtime/npm"
"$stage/app/.runtime/node" "$stage/app/.runtime/npm/bin/npm-cli.js" --version \
  > "$stage/app/.runtime/NPM_VERSION"
cp -a .next/standalone/. "$stage/app/"
cp -a .next/static "$stage/app/.next/static"
cp -a public "$stage/app/public"
cp package.json package-lock.json "$stage/app/"
cp -a prisma "$stage/app/prisma"
cp -a data lib "$stage/app/"
cp scripts/ingest-festivals.mjs "$stage/app/scripts/"
cp scripts/deploy/reconfigure-webserver.sh "$stage/app/scripts/deploy/"
chmod 0755 "$stage/app/scripts/deploy/reconfigure-webserver.sh"
printf '%s\n' "$commit" > "$stage/app/DEPLOYED_COMMIT"
tar -C "$stage" -czf "$output" app
archive_contents="$stage/archive-contents.txt"
tar -tzf "$output" > "$archive_contents"
grep -Fxq 'app/scripts/deploy/reconfigure-webserver.sh' "$archive_contents"
grep -Fxq 'app/.runtime/npm/bin/npm-cli.js' "$archive_contents"
grep -Fxq 'app/.runtime/NPM_VERSION' "$archive_contents"
