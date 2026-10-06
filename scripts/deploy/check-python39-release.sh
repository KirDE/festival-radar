#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: check-python39-release.sh RELEASE.tar.gz}"
test "$(python3.9 -c 'import sys; print(sys.version_info[:2] == (3, 9))')" = True
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
test -d "$stage/app/.python"
PYTHONPATH="$stage/app/.python:$stage/app/scripts/spotify_gmm_2026" python3.9 - "$stage/app" <<'PY'
import importlib.metadata as metadata
import json
import pathlib
import py_compile
import sys
import tempfile

app = pathlib.Path(sys.argv[1])
pins = dict(line.split("==", 1) for line in (app / "requirements.txt").read_text().splitlines()
            if line and not line.startswith("#"))
for name, version in pins.items():
    distribution = metadata.distribution(name)
    assert pathlib.Path(distribution.locate_file("")).resolve() == (app / ".python").resolve(), name
    assert distribution.version == version, name
    print(name, distribution.version)

import requests
from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth.credentials import OAuthCredentials
from youtube_music_transfer import load_ytmusic, youtube_data_api_headers

assert callable(load_ytmusic) and callable(youtube_data_api_headers)
assert callable(YTMusic) and callable(OAuthCredentials)
with tempfile.TemporaryDirectory() as directory:
    credentials = pathlib.Path(directory) / "credentials.json"
    token = pathlib.Path(directory) / "token.json"
    token.write_text(json.dumps({"access_token": "test-only", "expires_at": 4102444800}))
    assert youtube_data_api_headers(credentials, token)["Authorization"] == "Bearer test-only"
for path in (app / "scripts" / "spotify_gmm_2026").glob("*.py"):
    py_compile.compile(str(path), doraise=True)
print("Python 3.9 artifact imports and playlist script syntax OK")
PY
