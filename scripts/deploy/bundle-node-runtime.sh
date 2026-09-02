#!/usr/bin/env bash
set -euo pipefail

runtime="${1:?usage: bundle-node-runtime.sh RUNTIME_DIRECTORY}"
mkdir -p "$runtime"

cp "$(command -v node)" "$runtime/node"
chmod 0755 "$runtime/node"

npm_cli="$(readlink -f "$(command -v npm)")"
npm_root="$(dirname "$(dirname "$npm_cli")")"
test -f "$npm_root/bin/npm-cli.js"
cp -a "$npm_root" "$runtime/npm"
"$runtime/node" "$runtime/npm/bin/npm-cli.js" --version > "$runtime/NPM_VERSION"
