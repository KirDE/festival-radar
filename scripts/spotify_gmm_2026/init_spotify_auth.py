import json
import sys

from spotify_auth import exchange_code, load_tokens, refresh_access_token


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == '--refresh-only':
        tokens = refresh_access_token()
        print(json.dumps({'status': 'refreshed', 'has_refresh_token': bool(tokens.get('refresh_token'))}, ensure_ascii=False))
        return

    if len(sys.argv) < 2:
        existing = load_tokens()
        print(json.dumps({
            'usage': 'python init_spotify_auth.py <authorization_code> | --refresh-only',
            'token_file_present': bool(existing),
            'has_refresh_token': bool(existing.get('refresh_token')),
        }, ensure_ascii=False))
        raise SystemExit(1)

    code = sys.argv[1]
    tokens = exchange_code(code)
    print(json.dumps({
        'status': 'ok',
        'has_access_token': bool(tokens.get('access_token')),
        'has_refresh_token': bool(tokens.get('refresh_token')),
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
