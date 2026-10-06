#!/usr/bin/env bash
# Synthetic only: never reads a host database or a production archive.
set -euo pipefail
docker_bin=$(command -v docker)
docker() { env -u DOCKER_HOST -u DOCKER_CONTEXT "$docker_bin" --host unix:///var/run/docker.sock "$@"; }
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
container=''
cleanup() {
  if [[ -n $container ]]; then docker rm -f "$container" >/dev/null 2>&1 || :; fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT
container=$(docker run --rm -d --network none --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m -e POSTGRES_PASSWORD=disposable-only postgres:16-alpine)
for ((i=0; i<30; i++)); do
  if docker exec -u postgres "$container" pg_isready -q -U postgres 2>/dev/null; then break; fi
  if (( i == 29 )); then exit 1; fi
  sleep 1
done
docker exec -i -u postgres "$container" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL' >/dev/null
CREATE TABLE "Festival" (id int PRIMARY KEY);
CREATE TABLE "FestivalEdition" (id int PRIMARY KEY);
CREATE TABLE "Artist" (id int PRIMARY KEY);
CREATE TABLE "FestivalSource" (id int PRIMARY KEY);
CREATE TABLE "FestivalPlaylist" (id int PRIMARY KEY);
CREATE TABLE "AssetBlob" (id int PRIMARY KEY);
CREATE TABLE "FestivalLogo" (id int PRIMARY KEY);
INSERT INTO "Festival" VALUES (1);
INSERT INTO "FestivalEdition" VALUES (1);
SQL
docker exec -u postgres "$container" pg_dump -Fc -U postgres postgres > "$tmp/synthetic.dump"
chmod 0600 "$tmp/synthetic.dump"
python3 - "$tmp" <<'PY'
import hashlib, json, pathlib, sys
p = pathlib.Path(sys.argv[1])
counts = {key: int(key in ('Festival', 'FestivalEdition')) for key in (
    'Festival', 'FestivalEdition', 'Artist', 'FestivalSource', 'FestivalPlaylist', 'AssetBlob', 'FestivalLogo')}
sha = hashlib.sha256((p / 'synthetic.dump').read_bytes()).hexdigest()
(p / 'expected.json').write_text(json.dumps({'sha256': sha, 'counts': counts}))
counts['Artist'] = 1
(p / 'wrong-count.json').write_text(json.dumps({'sha256': sha, 'counts': counts}))
(p / 'wrong-hash.json').write_text(json.dumps({'sha256': '0' * 64, 'counts': counts}))
PY
script="$root/scripts/backup/verify-disposable-restore.sh"
DOCKER_HOST=tcp://127.0.0.1:1 "$script" "$tmp/synthetic.dump" "$tmp/expected.json"
if "$script" "$tmp/synthetic.dump" "$tmp/wrong-count.json"; then
  echo 'count mismatch was accepted' >&2; exit 1
fi
if "$script" "$tmp/synthetic.dump" "$tmp/wrong-hash.json"; then
  echo 'checksum mismatch was accepted' >&2; exit 1
fi
if "$script" "$tmp/synthetic.dump" "$tmp/expected.json" 'postgresql://production'; then
  echo 'target URL argument was accepted' >&2; exit 1
fi
echo 'synthetic restore, wrong count, wrong checksum and target rejection passed'
