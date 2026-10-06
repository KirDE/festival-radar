#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 || $1 != /* || $2 != /* || ! -f $1 || ! -f $2 || -L $1 || -L $2 ]]; then
  echo 'usage: verify-disposable-restore.sh trusted.dump expected-counts.json (no target URL)' >&2
  exit 2
fi
archive=$(realpath -- "$1")
expected=$(realpath -- "$2")
docker_bin=$(command -v docker)
# Explicit local socket: never honor an operator environment pointing at a remote Docker host.
docker() { env -u DOCKER_HOST -u DOCKER_CONTEXT "$docker_bin" --host unix:///var/run/docker.sock "$@"; }
command -v python3 >/dev/null
python3 - "$expected" "$archive" <<'PY'
import hashlib, json, pathlib, re, sys
keys = ('Festival', 'FestivalEdition', 'Artist', 'FestivalSource', 'FestivalPlaylist', 'AssetBlob', 'FestivalLogo')
try:
    manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
    assert type(manifest) is dict and set(manifest) == {'sha256', 'counts'}
    assert type(manifest['counts']) is dict and set(manifest['counts']) == set(keys)
    assert all(type(manifest['counts'][key]) is int and manifest['counts'][key] >= 0 for key in keys)
    assert type(manifest['sha256']) is str and re.fullmatch('[0-9a-f]{64}', manifest['sha256'])
    with open(sys.argv[2], 'rb') as archive:
        digest = hashlib.file_digest(archive, 'sha256').hexdigest()
    assert digest == manifest['sha256']
except (AssertionError, OSError, ValueError, TypeError, KeyError):
    sys.exit('invalid manifest or checksum mismatch; no restore attempted')
PY
container=''
cleanup() { if [[ -n $container ]]; then docker rm -f "$container" >/dev/null 2>&1 || :; fi; }
trap cleanup EXIT
# New private database, no host mount, network, exposed port or supplied target.
container=$(docker run --rm -d --network none --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m -e POSTGRES_PASSWORD=disposable-only postgres:16-alpine)
for ((i=0; i<30; i++)); do
  if docker exec -u postgres "$container" pg_isready -q -U postgres 2>/dev/null; then break; fi
  if (( i == 29 )); then echo 'disposable database did not start' >&2; exit 1; fi
  sleep 1
done
docker exec -u postgres "$container" createdb -U postgres festival_restore
docker cp "$archive" "$container:/tmp/restore.dump" >/dev/null
docker exec -u root "$container" chown postgres:postgres /tmp/restore.dump
docker exec -u root "$container" chmod 0400 /tmp/restore.dump
docker exec -u postgres "$container" pg_restore --list /tmp/restore.dump >/dev/null
docker exec -u postgres "$container" pg_restore --exit-on-error --single-transaction \
  --no-owner --no-acl -U postgres -d festival_restore /tmp/restore.dump >/dev/null
query=$(cat <<'SQL'
SELECT json_build_object(
  'Festival', (SELECT count(*) FROM "Festival"),
  'FestivalEdition', (SELECT count(*) FROM "FestivalEdition"),
  'Artist', (SELECT count(*) FROM "Artist"),
  'FestivalSource', (SELECT count(*) FROM "FestivalSource"),
  'FestivalPlaylist', (SELECT count(*) FROM "FestivalPlaylist"),
  'AssetBlob', (SELECT count(*) FROM "AssetBlob"),
  'FestivalLogo', (SELECT count(*) FROM "FestivalLogo"));
SQL
)
counts=$(docker exec -u postgres "$container" psql -X -At -v ON_ERROR_STOP=1 \
  -U postgres -d festival_restore -c "$query")
python3 - "$expected" "$counts" <<'PY'
import json, pathlib, sys
actual = json.loads(sys.argv[2])
expected = json.loads(pathlib.Path(sys.argv[1]).read_text())['counts']
if actual != expected:
    sys.exit('restore count parity failed; disposable database will be removed')
print('disposable restore succeeded; independent manifest count parity:', json.dumps(actual, sort_keys=True))
PY
