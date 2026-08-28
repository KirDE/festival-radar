import argparse
import json
import time
from pathlib import Path

from ytmusicapi.auth.oauth import OAuthCredentials, RefreshingToken

DEFAULT_CREDENTIALS = Path('/home/openclaw/.openclaw/credentials/youtube-music.json')
DEFAULT_OAUTH = Path('/home/openclaw/.openclaw/credentials/youtube-music-oauth.json')


def setup_oauth_polling(client_id: str, client_secret: str, oauth_path: Path, timeout_seconds: int) -> None:
    credentials = OAuthCredentials(client_id, client_secret)
    code = credentials.get_code()
    url = f"{code['verification_url']}?user_code={code['user_code']}"
    interval = int(code.get('interval') or 5)
    expires_in = int(code.get('expires_in') or timeout_seconds)
    deadline = time.time() + min(timeout_seconds, expires_in)
    print(f'Go to {url} and finish the login flow. Waiting for approval...', flush=True)

    while time.time() < deadline:
        raw_token = credentials.token_from_code(code['device_code'])
        error = raw_token.get('error')
        if not error:
            refresh_token_expires_in = raw_token.get('refresh_token_expires_in', raw_token['expires_in'])
            ref_token = RefreshingToken(
                credentials=credentials,
                access_token=raw_token['access_token'],
                refresh_token=raw_token['refresh_token'],
                scope=raw_token['scope'],
                token_type=raw_token['token_type'],
                expires_in=refresh_token_expires_in,
            )
            ref_token.update(raw_token)
            ref_token.store_token(str(oauth_path))
            oauth_path.chmod(0o600)
            return
        if error == 'authorization_pending':
            time.sleep(interval)
            continue
        if error == 'slow_down':
            interval += 5
            time.sleep(interval)
            continue
        raise RuntimeError(f'YouTube Music OAuth failed: {error}')

    raise TimeoutError('YouTube Music OAuth approval timed out')


def main() -> int:
    parser = argparse.ArgumentParser(description='Create a YouTube Music OAuth token with device-flow auth.')
    parser.add_argument('--credentials', default=str(DEFAULT_CREDENTIALS))
    parser.add_argument('--oauth', default=str(DEFAULT_OAUTH))
    parser.add_argument('--timeout-seconds', type=int, default=900)
    args = parser.parse_args()

    credentials_path = Path(args.credentials)
    oauth_path = Path(args.oauth)
    credentials = json.loads(credentials_path.read_text(encoding='utf-8'))
    oauth_path.parent.mkdir(parents=True, exist_ok=True)
    setup_oauth_polling(
        credentials['client_id'],
        credentials['client_secret'],
        oauth_path,
        args.timeout_seconds,
    )
    print(f'Saved YouTube Music OAuth token to {oauth_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
