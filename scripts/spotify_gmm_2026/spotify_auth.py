import base64
import json
import os
import time
from pathlib import Path

import requests

TOKEN_PATH = Path(os.environ.get('SPOTIFY_TOKEN_PATH', 'tmp/spotify_tokens.json'))
REDIRECT_URI = os.environ.get('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8888/callback')
CLIENT_ID = os.environ.get('SPOTIFY_CLIENT_ID')
CLIENT_SECRET = os.environ.get('SPOTIFY_CLIENT_SECRET')


class SpotifyAuthError(RuntimeError):
    pass


def _require_env() -> None:
    if not CLIENT_ID or not CLIENT_SECRET:
        raise SpotifyAuthError('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required')


def _basic_auth_header() -> str:
    raw = f'{CLIENT_ID}:{CLIENT_SECRET}'.encode()
    return 'Basic ' + base64.b64encode(raw).decode()


def _token_request(data: dict, retries=4) -> dict:
    _require_env()
    for attempt in range(retries + 1):
        try:
            response = requests.post(
                'https://accounts.spotify.com/api/token',
                headers={'Authorization': _basic_auth_header()},
                data=data,
                timeout=30,
            )
        except requests.exceptions.RequestException:
            if attempt < retries:
                time.sleep(max(5, 2 ** attempt))
                continue
            raise
        if response.status_code in {500, 502, 503, 504, 429} and attempt < retries:
            retry_after = response.headers.get('Retry-After')
            wait = float(retry_after) if retry_after and retry_after.isdigit() else max(5, 2 ** attempt)
            time.sleep(wait)
            continue
        response.raise_for_status()
        payload = response.json()
        payload['obtained_at'] = int(time.time())
        return payload
    response.raise_for_status()
    return {}


def load_tokens() -> dict:
    if not TOKEN_PATH.exists():
        return {}
    return json.loads(TOKEN_PATH.read_text(encoding='utf-8'))


def save_tokens(tokens: dict) -> None:
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(json.dumps(tokens, ensure_ascii=False, indent=2), encoding='utf-8')


def exchange_code(code: str) -> dict:
    tokens = _token_request({
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI,
    })
    save_tokens(tokens)
    return tokens


def refresh_access_token(refresh_token: str | None = None) -> dict:
    tokens = load_tokens()
    refresh_token = refresh_token or tokens.get('refresh_token')
    if not refresh_token:
        raise SpotifyAuthError('No refresh_token available. Run code exchange first.')
    refreshed = _token_request({
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
    })
    if 'refresh_token' not in refreshed:
        refreshed['refresh_token'] = refresh_token
    merged = {**tokens, **refreshed}
    save_tokens(merged)
    return merged


def get_valid_access_token() -> str:
    tokens = load_tokens()
    access_token = tokens.get('access_token')
    expires_in = tokens.get('expires_in', 0)
    obtained_at = tokens.get('obtained_at', 0)
    now = int(time.time())
    if access_token and now < obtained_at + int(expires_in) - 120:
        return access_token
    refreshed = refresh_access_token(tokens.get('refresh_token'))
    return refreshed['access_token']


def auth_headers() -> dict:
    return {'Authorization': f'Bearer {get_valid_access_token()}'}
